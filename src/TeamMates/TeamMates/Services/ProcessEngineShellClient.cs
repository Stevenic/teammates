using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using TeamMates.Contracts;

namespace TeamMates.Services;

public sealed class ProcessEngineShellClient : IEngineShellClient, IAsyncDisposable
{
    private const string DefaultAdapterName = "codex";
    private const string TransportVersion = "v1";
    private static readonly IReadOnlyList<ShellAdapterOption> KnownAdapters =
    [
        new("codex", "Codex"),
        new("copilot", "Copilot"),
        new("claude", "Claude"),
        new("aider", "Aider"),
        new("echo", "Echo"),
    ];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> _pendingCommands = new(StringComparer.Ordinal);
    private readonly CancellationTokenSource _readerCts = new();
    private readonly string _bridgeRepoRoot;
    private readonly string _bridgeScriptPath;
    private readonly string _nodeExecutable;
    private readonly string? _modelOverride;
    private readonly string? _adapterOverride;
    private readonly ShellSettingsStore _bootstrapSettingsStore;
    private string _teammatesDir;
    private string _workingDirectory;
    private ShellSettingsStore _settingsStore;
    private Process? _process;
    private StreamWriter? _stdin;
    private Task? _stdoutReaderTask;
    private bool _initialized;
    private int _commandSequence;
    private string _adapterName;
    private ShellStateSnapshotDto _currentSnapshot = CreateDisconnectedSnapshot("Starting shell bridge...");

    public ProcessEngineShellClient(
        string bridgeRepoRoot,
        string workingDirectory,
        string bridgeScriptPath,
        ShellSettingsStore bootstrapSettingsStore,
        ShellSettingsStore settingsStore,
        string adapterName = DefaultAdapterName,
        string? modelOverride = null,
        string nodeExecutable = "node")
    {
        _bridgeRepoRoot = bridgeRepoRoot;
        _workingDirectory = workingDirectory;
        _teammatesDir = Path.Combine(workingDirectory, ".teammates");
        _bridgeScriptPath = bridgeScriptPath;
        _bootstrapSettingsStore = bootstrapSettingsStore;
        _settingsStore = settingsStore;
        _adapterName = adapterName;
        _modelOverride = modelOverride;
        _nodeExecutable = nodeExecutable;
        _adapterOverride = Environment.GetEnvironmentVariable("TEAMMATES_SHELL_ADAPTER");
    }

    public event EventHandler<ShellStateSnapshotDto>? ShellStateChanged;

    public string CurrentAdapterName => _adapterName;

    public string WorkingDirectory => _workingDirectory;

    public IReadOnlyList<ShellAdapterOption> AvailableAdapters => KnownAdapters;

    public static IEngineShellClient CreateDefault()
    {
        try
        {
            var repoRoot = ResolveRepoRoot(AppContext.BaseDirectory);
            var bridgeScriptPath = Path.Combine(repoRoot, "packages", "cli", "dist", "shell-bridge-cli.js");
            var bootstrapSettingsStore = new ShellSettingsStore(Path.Combine(repoRoot, ".teammates", "settings.json"));
            var configuredWorkingDirectory = bootstrapSettingsStore.GetWorkingDirectoryAsync().GetAwaiter().GetResult();
            var workingDirectory = string.IsNullOrWhiteSpace(configuredWorkingDirectory)
                ? repoRoot
                : Path.GetFullPath(configuredWorkingDirectory);
            var teammatesDir = Path.Combine(workingDirectory, ".teammates");
            var settingsStore = new ShellSettingsStore(Path.Combine(teammatesDir, "settings.json"));
            var adapterName = settingsStore.GetAdapterNameAsync().GetAwaiter().GetResult();
            var adapterOverride = Environment.GetEnvironmentVariable("TEAMMATES_SHELL_ADAPTER");

            if (!File.Exists(bridgeScriptPath))
            {
                return new UnavailableEngineShellClient(
                    $"Bridge script not found at '{bridgeScriptPath}'. Build packages\\cli first.",
                    workingDirectory,
                    adapterName,
                    bootstrapSettingsStore,
                    settingsStore);
            }

            if (!Directory.Exists(teammatesDir))
            {
                return new UnavailableEngineShellClient(
                    $"Could not locate teammates directory at '{teammatesDir}'.",
                    workingDirectory,
                    adapterName,
                    bootstrapSettingsStore,
                    settingsStore);
            }

            return new ProcessEngineShellClient(
                repoRoot,
                workingDirectory,
                bridgeScriptPath,
                bootstrapSettingsStore,
                settingsStore,
                adapterName: adapterOverride ?? adapterName,
                modelOverride: Environment.GetEnvironmentVariable("TEAMMATES_SHELL_MODEL"));
        }
        catch (Exception error)
        {
            return new UnavailableEngineShellClient(error.Message, Environment.CurrentDirectory, DefaultAdapterName, null, null);
        }
    }

    public async Task<ShellStateSnapshotDto> GetShellStateAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await EnsureStartedAsync(cancellationToken);
            var snapshot = await SendCommandAsync<ShellStateSnapshotDto>("get_shell_state", new Dictionary<string, string>(), cancellationToken);
            ApplySnapshot(snapshot);
        }
        catch (Exception error)
        {
            ApplySnapshot(CreateDisconnectedSnapshot(error.Message));
        }

        return _currentSnapshot;
    }

    public async Task SendInputAsync(string targetId, string text, CancellationToken cancellationToken = default)
    {
        await EnsureStartedAsync(cancellationToken);
        await SendCommandAsync<object>("send_input", new SendInputPayload(targetId, text, "tomlm"), cancellationToken);
    }

    public async Task SetAdapterAsync(string adapterName, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(adapterName);

        if (!KnownAdapters.Any(option => string.Equals(option.Name, adapterName, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException($"Unsupported adapter '{adapterName}'.");
        }

        if (string.Equals(_adapterName, adapterName, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        await _settingsStore.SetAdapterNameAsync(adapterName, cancellationToken);

        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            _adapterName = adapterName;
            _initialized = false;
            await StopProcessAsync();
            ApplySnapshot(CreateDisconnectedSnapshot($"Switching shell bridge to {adapterName}..."));
        }
        finally
        {
            _syncLock.Release();
        }

        await GetShellStateAsync(cancellationToken);
    }

    public async Task SetWorkingDirectoryAsync(string workingDirectory, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workingDirectory);

        var fullWorkingDirectory = Path.GetFullPath(workingDirectory);
        var teammatesDir = Path.Combine(fullWorkingDirectory, ".teammates");
        var settingsStore = new ShellSettingsStore(Path.Combine(teammatesDir, "settings.json"));
        var adapterName = _adapterOverride ?? await settingsStore.GetAdapterNameAsync(cancellationToken);

        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            if (string.Equals(_workingDirectory, fullWorkingDirectory, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            _workingDirectory = fullWorkingDirectory;
            _teammatesDir = teammatesDir;
            _settingsStore = settingsStore;
            _adapterName = adapterName;
            _initialized = false;
            await _bootstrapSettingsStore.SetWorkingDirectoryAsync(fullWorkingDirectory, cancellationToken);
            await _settingsStore.SetWorkingDirectoryAsync(fullWorkingDirectory, cancellationToken);
            await StopProcessAsync();
            ApplySnapshot(CreateDisconnectedSnapshot($"Switching shell bridge to '{fullWorkingDirectory}'..."));
        }
        finally
        {
            _syncLock.Release();
        }

        await GetShellStateAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        _readerCts.Cancel();
        await StopProcessAsync();
    }

    private async Task StopProcessAsync()
    {
        if (_stdin is not null)
        {
            await _stdin.DisposeAsync();
            _stdin = null;
        }

        if (_process is not null)
        {
            try
            {
                if (!_process.HasExited)
                {
                    _process.Kill(entireProcessTree: true);
                    await _process.WaitForExitAsync();
                }
            }
            catch
            {
                // Best-effort shutdown.
            }

            _process.Dispose();
            _process = null;
        }

        if (_stdoutReaderTask is not null)
        {
            await _stdoutReaderTask;
            _stdoutReaderTask = null;
        }
    }

    private async Task EnsureStartedAsync(CancellationToken cancellationToken)
    {
        if (_process is not null && !_process.HasExited && _initialized)
        {
            return;
        }

        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            if (_process is not null && !_process.HasExited && _initialized)
            {
                return;
            }

            await StartProcessAsync(cancellationToken);
            await SendCommandAsync<object>("initialize_shell", new InitializeShellPayload("Avalonia", "0.1.0"), cancellationToken);
            _initialized = true;
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task StartProcessAsync(CancellationToken cancellationToken)
    {
        if (_process is not null)
        {
            await StopProcessAsync();
        }

        var arguments = new StringBuilder();
        arguments.Append($"\"{_bridgeScriptPath}\" {_adapterName}");
        arguments.Append($" --dir \"{_teammatesDir}\"");

        if (!string.IsNullOrWhiteSpace(_modelOverride))
        {
            arguments.Append($" --model \"{_modelOverride}\"");
        }

        var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = _nodeExecutable,
                Arguments = arguments.ToString(),
                WorkingDirectory = _bridgeRepoRoot,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            },
            EnableRaisingEvents = true,
        };

        process.Exited += (_, _) =>
        {
            var reason = process.ExitCode == 0
                ? "Shell bridge exited."
                : $"Shell bridge exited with code {process.ExitCode}.";
            ApplySnapshot(CreateDisconnectedSnapshot(reason));
            FailPendingCommands(reason);
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Failed to launch teammates shell bridge.");
        }

        _process = process;
        _stdin = process.StandardInput;
        _stdoutReaderTask = Task.Run(() => ReadStdoutLoopAsync(process, _readerCts.Token), cancellationToken);
        _ = Task.Run(() => ReadStderrLoopAsync(process, _readerCts.Token), cancellationToken);
        await Task.CompletedTask;
    }

    private async Task ReadStdoutLoopAsync(Process process, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && !process.HasExited)
        {
            var line = await process.StandardOutput.ReadLineAsync(cancellationToken);
            if (line is null)
            {
                break;
            }

            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            try
            {
                using var document = JsonDocument.Parse(line);
                await HandleIncomingEnvelopeAsync(document.RootElement);
            }
            catch (Exception error)
            {
                ApplySnapshot(CreateDisconnectedSnapshot($"Bridge protocol error: {error.Message}"));
            }
        }
    }

    private async Task ReadStderrLoopAsync(Process process, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && !process.HasExited)
        {
            var line = await process.StandardError.ReadLineAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            ApplySnapshot(CreateDisconnectedSnapshot(line));
        }
    }

    private async Task HandleIncomingEnvelopeAsync(JsonElement envelope)
    {
        if (!envelope.TryGetProperty("kind", out var kindProperty))
        {
            return;
        }

        switch (kindProperty.GetString())
        {
            case "response":
                ResolveResponse(envelope);
                break;
            case "error":
                ResolveError(envelope);
                break;
            case "event":
                await HandleEventAsync(envelope);
                break;
        }
    }

    private void ResolveResponse(JsonElement envelope)
    {
        if (!envelope.TryGetProperty("id", out var idProperty))
        {
            return;
        }

        var id = idProperty.GetString();
        if (string.IsNullOrWhiteSpace(id))
        {
            return;
        }

        if (_pendingCommands.TryRemove(id, out var pending))
        {
            var payload = envelope.GetProperty("payload").Clone();
            pending.TrySetResult(payload);
        }
    }

    private void ResolveError(JsonElement envelope)
    {
        if (envelope.TryGetProperty("message", out var messageProperty))
        {
            ApplySnapshot(CreateDisconnectedSnapshot(messageProperty.GetString() ?? "Shell bridge error."));
        }

        if (!envelope.TryGetProperty("id", out var idProperty))
        {
            return;
        }

        var id = idProperty.GetString();
        if (string.IsNullOrWhiteSpace(id))
        {
            return;
        }

        if (_pendingCommands.TryRemove(id, out var pending))
        {
            var message = envelope.TryGetProperty("message", out var property)
                ? property.GetString() ?? "Shell bridge error."
                : "Shell bridge error.";
            pending.TrySetException(new InvalidOperationException(message));
        }
    }

    private async Task HandleEventAsync(JsonElement envelope)
    {
        if (!envelope.TryGetProperty("event", out var eventProperty))
        {
            return;
        }

        var eventName = eventProperty.GetString();
        if (string.IsNullOrWhiteSpace(eventName) || !envelope.TryGetProperty("payload", out var payload))
        {
            return;
        }

        switch (eventName)
        {
            case "shell_state_snapshot":
                var snapshot = payload.Deserialize<ShellStateSnapshotDto>(JsonOptions);
                if (snapshot is not null)
                {
                    ApplySnapshot(snapshot);
                }
                break;
            case "engine_ready":
                if (payload.TryGetProperty("adapterName", out var adapterNameProperty))
                {
                    var adapterName = NormalizeAdapterName(adapterNameProperty.GetString());
                    if (!string.IsNullOrWhiteSpace(adapterName))
                    {
                        _adapterName = adapterName;
                    }
                }
                ApplySnapshot(_currentSnapshot with
                {
                    ConnectionState = "Connected",
                    TransportVersion = payload.TryGetProperty("transportVersion", out var transportVersion)
                        ? transportVersion.GetString() ?? TransportVersion
                        : TransportVersion,
                });
                break;
            case "feed_item_added":
                var feedItem = payload.Deserialize<FeedItemDto>(JsonOptions);
                if (feedItem is not null)
                {
                    ApplySnapshot(_currentSnapshot with
                    {
                        ConnectionState = "Connected",
                        FeedItems = [.. _currentSnapshot.FeedItems, feedItem],
                    });
                }
                break;
            case "teammate_status_changed":
                UpdateTabStatus(payload);
                break;
            case "task_started":
                UpdateTaskState(payload, "running");
                break;
            case "task_completed":
                UpdateTaskState(payload, "idle");
                break;
            case "task_failed":
                UpdateTaskState(payload, "error");
                break;
            case "engine_error":
                ApplySnapshot(CreateDisconnectedSnapshot(
                    payload.TryGetProperty("message", out var message)
                        ? message.GetString() ?? "Shell bridge error."
                        : "Shell bridge error."));
                break;
        }

        await Task.CompletedTask;
    }

    private void UpdateTabStatus(JsonElement payload)
    {
        if (!payload.TryGetProperty("targetId", out var targetIdProperty))
        {
            return;
        }

        var targetId = targetIdProperty.GetString();
        if (string.IsNullOrWhiteSpace(targetId))
        {
            return;
        }

        var tabs = _currentSnapshot.Tabs
            .Select(tab => tab.Id == targetId
                ? tab with
                {
                    ActivityState = payload.TryGetProperty("activityState", out var activityState)
                        ? activityState.GetString() ?? tab.ActivityState
                        : tab.ActivityState,
                }
                : tab)
            .ToArray();

        ApplySnapshot(_currentSnapshot with { Tabs = tabs, ConnectionState = "Connected" });
    }

    private void UpdateTaskState(JsonElement payload, string activityState)
    {
        if (!payload.TryGetProperty("targetId", out var targetIdProperty))
        {
            return;
        }

        var targetId = targetIdProperty.GetString();
        if (string.IsNullOrWhiteSpace(targetId))
        {
            return;
        }

        var tabs = _currentSnapshot.Tabs
            .Select(tab => tab.Id == targetId
                ? tab with { ActivityState = activityState }
                : tab)
            .ToArray();

        ApplySnapshot(_currentSnapshot with { Tabs = tabs, ConnectionState = "Connected" });
    }

    private async Task<TPayload> SendCommandAsync<TPayload>(string command, object payload, CancellationToken cancellationToken)
    {
        if (_stdin is null || _process is null || _process.HasExited)
        {
            throw new InvalidOperationException("Shell bridge is not running.");
        }

        var id = $"cmd-{Interlocked.Increment(ref _commandSequence):D4}";
        var pending = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingCommands[id] = pending;

        var envelope = new CommandEnvelope(command, id, DateTimeOffset.UtcNow, payload);
        var json = JsonSerializer.Serialize(envelope, JsonOptions);
        await _stdin.WriteLineAsync(json.AsMemory(), cancellationToken);
        await _stdin.FlushAsync(cancellationToken);

        using var registration = cancellationToken.Register(() =>
        {
            if (_pendingCommands.TryRemove(id, out var source))
            {
                source.TrySetCanceled(cancellationToken);
            }
        });

        var responsePayload = await pending.Task;
        var result = responsePayload.Deserialize<TPayload>(JsonOptions);
        if (result is null)
        {
            throw new InvalidOperationException($"Bridge returned an empty '{command}' payload.");
        }

        return result;
    }

    private void ApplySnapshot(ShellStateSnapshotDto snapshot)
    {
        _currentSnapshot = snapshot;
        ShellStateChanged?.Invoke(this, snapshot);
    }

    private void FailPendingCommands(string message)
    {
        foreach (var pending in _pendingCommands)
        {
            if (_pendingCommands.TryRemove(pending.Key, out var source))
            {
                source.TrySetException(new InvalidOperationException(message));
            }
        }
    }

    private static string? NormalizeAdapterName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim().ToLowerInvariant();
        return normalized switch
        {
            "codexadapter" => "codex",
            "copilotadapter" => "copilot",
            "echoadapter" => "echo",
            "cliproxyadapter" => "codex",
            _ => normalized,
        };
    }

    private static ShellStateSnapshotDto CreateDisconnectedSnapshot(string message)
    {
        return new ShellStateSnapshotDto(
            ActiveTabId: "team",
            ConnectionState: "Disconnected",
            TransportVersion: TransportVersion,
            Tabs:
            [
                new TabStateDto(
                    Id: "team",
                    TargetKind: ShellTargetKind.Team,
                    DisplayName: "TEAM",
                    ActivityState: "error",
                    ComposerEnabled: false,
                    ComposerDisabledReason: message,
                    UnreadCount: 0)
            ],
            FeedItems:
            [
                new FeedItemDto(
                    Id: "feed-disconnected",
                    TargetId: "team",
                    Title: "Shell bridge unavailable",
                    Body: message,
                    Timestamp: DateTimeOffset.Now,
                    Author: "system",
                    Status: "error")
            ]);
    }

    private static string ResolveRepoRoot(string startDirectory)
    {
        var current = new DirectoryInfo(startDirectory);
        while (current is not null)
        {
            var packageJson = Path.Combine(current.FullName, "package.json");
            var cliDist = Path.Combine(current.FullName, "packages", "cli", "dist", "shell-bridge-cli.js");
            if (File.Exists(packageJson) && File.Exists(cliDist))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new DirectoryNotFoundException("Could not resolve teammates repo root from application base directory.");
    }

    private sealed record CommandEnvelope(
        [property: JsonPropertyName("command")] string Command,
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("timestamp")] DateTimeOffset Timestamp,
        [property: JsonPropertyName("payload")] object Payload)
    {
        [JsonPropertyName("kind")]
        public string Kind => "command";

        [JsonPropertyName("version")]
        public int Version => 1;
    }

    private sealed record InitializeShellPayload(
        [property: JsonPropertyName("shellName")] string ShellName,
        [property: JsonPropertyName("shellVersion")] string ShellVersion);

    private sealed record SendInputPayload(
        [property: JsonPropertyName("targetId")] string TargetId,
        [property: JsonPropertyName("text")] string Text,
        [property: JsonPropertyName("author")] string Author);
}

internal sealed class UnavailableEngineShellClient : IEngineShellClient
{
    private readonly ShellStateSnapshotDto _snapshot;
    private readonly ShellSettingsStore? _bootstrapSettingsStore;
    private readonly ShellSettingsStore? _settingsStore;
    private string _adapterName;

    private static readonly IReadOnlyList<ShellAdapterOption> KnownAdapters =
    [
        new("codex", "Codex"),
        new("copilot", "Copilot"),
        new("claude", "Claude"),
        new("aider", "Aider"),
        new("echo", "Echo"),
    ];

    public UnavailableEngineShellClient(
        string message,
        string workingDirectory,
        string adapterName,
        ShellSettingsStore? bootstrapSettingsStore,
        ShellSettingsStore? settingsStore)
    {
        WorkingDirectory = workingDirectory;
        _adapterName = adapterName;
        _bootstrapSettingsStore = bootstrapSettingsStore;
        _settingsStore = settingsStore;
        _snapshot = new ShellStateSnapshotDto(
            ActiveTabId: "team",
            ConnectionState: "Disconnected",
            TransportVersion: "v1",
            Tabs:
            [
                new TabStateDto(
                    Id: "team",
                    TargetKind: ShellTargetKind.Team,
                    DisplayName: "TEAM",
                    ActivityState: "error",
                    ComposerEnabled: false,
                    ComposerDisabledReason: message,
                    UnreadCount: 0)
            ],
            FeedItems:
            [
                new FeedItemDto(
                    Id: "feed-unavailable",
                    TargetId: "team",
                    Title: "Shell bridge unavailable",
                    Body: message,
                    Timestamp: DateTimeOffset.Now,
                    Author: "system",
                    Status: "error")
            ]);
    }

    public event EventHandler<ShellStateSnapshotDto>? ShellStateChanged
    {
        add { }
        remove { }
    }

    public string CurrentAdapterName => _adapterName;

    public string WorkingDirectory { get; private set; }

    public IReadOnlyList<ShellAdapterOption> AvailableAdapters => KnownAdapters;

    public Task<ShellStateSnapshotDto> GetShellStateAsync(CancellationToken cancellationToken = default)
    {
        return Task.FromResult(_snapshot);
    }

    public Task SendInputAsync(string targetId, string text, CancellationToken cancellationToken = default)
    {
        throw new InvalidOperationException(_snapshot.Tabs[0].ComposerDisabledReason ?? "Shell bridge unavailable.");
    }

    public async Task SetAdapterAsync(string adapterName, CancellationToken cancellationToken = default)
    {
        _adapterName = adapterName;
        if (_settingsStore is not null)
        {
            await _settingsStore.SetAdapterNameAsync(adapterName, cancellationToken);
        }
    }

    public async Task SetWorkingDirectoryAsync(string workingDirectory, CancellationToken cancellationToken = default)
    {
        WorkingDirectory = Path.GetFullPath(workingDirectory);
        if (_bootstrapSettingsStore is not null)
        {
            await _bootstrapSettingsStore.SetWorkingDirectoryAsync(WorkingDirectory, cancellationToken);
        }
        if (_settingsStore is not null)
        {
            await _settingsStore.SetWorkingDirectoryAsync(WorkingDirectory, cancellationToken);
        }
    }
}
