using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace TeamMates.Services;

public sealed class ShellSettingsStore
{
    private const string DefaultAdapterName = "codex";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true
    };

    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private readonly string _settingsPath;

    public ShellSettingsStore(string settingsPath)
    {
        _settingsPath = settingsPath;
    }

    public async Task<string> GetAdapterNameAsync(CancellationToken cancellationToken = default)
    {
        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            var root = await LoadRootAsync(cancellationToken);
            return root?["shell"]?["adapterName"]?.GetValue<string>() ?? DefaultAdapterName;
        }
        finally
        {
            _syncLock.Release();
        }
    }

    public async Task<string?> GetWorkingDirectoryAsync(CancellationToken cancellationToken = default)
    {
        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            var root = await LoadRootAsync(cancellationToken);
            return root?["shell"]?["workingDirectory"]?.GetValue<string>();
        }
        finally
        {
            _syncLock.Release();
        }
    }

    public async Task SetAdapterNameAsync(string adapterName, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(adapterName);

        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            var root = await LoadRootAsync(cancellationToken) ?? new JsonObject();
            root["shell"] ??= new JsonObject();
            root["shell"]!["adapterName"] = adapterName;

            await SaveRootAsync(root, cancellationToken);
        }
        finally
        {
            _syncLock.Release();
        }
    }

    public async Task SetWorkingDirectoryAsync(string workingDirectory, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(workingDirectory);

        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            var root = await LoadRootAsync(cancellationToken) ?? new JsonObject();
            root["shell"] ??= new JsonObject();
            root["shell"]!["workingDirectory"] = workingDirectory;

            await SaveRootAsync(root, cancellationToken);
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task<JsonObject?> LoadRootAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_settingsPath))
        {
            return null;
        }

        var json = await File.ReadAllTextAsync(_settingsPath, cancellationToken);
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        return JsonNode.Parse(json)?.AsObject();
    }

    private async Task SaveRootAsync(JsonObject root, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(_settingsPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        await File.WriteAllTextAsync(
            _settingsPath,
            root.ToJsonString(JsonOptions) + Environment.NewLine,
            cancellationToken);
    }
}
