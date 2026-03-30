using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Avalonia;
using Avalonia.Threading;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using System.Linq;
using System;
using System.Threading.Tasks;
using System.Collections.ObjectModel;
using TeamMates.Contracts;
using TeamMates.Services;
using TeamMates.Views;

namespace TeamMates.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    private readonly IEngineShellClient _engineShellClient;

    public MainViewModel()
        : this(new DemoEngineShellClient())
    {
    }

    public MainViewModel(IEngineShellClient engineShellClient)
    {
        _engineShellClient = engineShellClient;
        _engineShellClient.ShellStateChanged += OnShellStateChanged;
        Tabs = [];
        _selectedAdapterName = _engineShellClient.CurrentAdapterName;
        _ = LoadAsync();
    }

    public ObservableCollection<ShellTabViewModel> Tabs { get; }

    [ObservableProperty]
    private ShellTabViewModel? _selectedTab;

    [ObservableProperty]
    private string _activeTabId = "team";

    [ObservableProperty]
    private string _composerText = string.Empty;

    [ObservableProperty]
    private string _connectionState = "Connecting";

    [ObservableProperty]
    private string _transportVersion = "v1";

    [ObservableProperty]
    private bool _isBusy;

    [ObservableProperty]
    private string _selectedAdapterName = "codex";

    [ObservableProperty]
    private string _workingDirectory = string.Empty;

    public string CurrentTargetLabel => SelectedTab?.DisplayName ?? "TEAM";

    public string ComposerPlaceholder => SelectedTab?.ComposerPlaceholder ?? "Message TEAM";

    public bool ComposerEnabled => SelectedTab?.ComposerEnabled ?? false;

    public string ComposerStatusText =>
        ComposerEnabled
            ? $"Routing to {CurrentTargetLabel} with explicit targetId `{ActiveTabId}`."
            : SelectedTab?.ComposerDisabledReason ?? "Input is unavailable for the selected target.";

    public ObservableCollection<FeedItemViewModel> VisibleFeedItems => SelectedTab?.FeedItems ?? [];

    public string SelectedAdapterDisplayName => GetAdapterDisplayName(SelectedAdapterName);

    public string WindowTitle =>
        string.IsNullOrWhiteSpace(WorkingDirectory)
            ? "TeamMates"
            : $"TeamMates - {WorkingDirectory}";

    public bool IsCodexSelected => IsAdapterSelected("codex");

    public bool IsCopilotSelected => IsAdapterSelected("copilot");

    public bool IsClaudeSelected => IsAdapterSelected("claude");

    public bool IsAiderSelected => IsAdapterSelected("aider");

    public bool IsEchoSelected => IsAdapterSelected("echo");

    partial void OnSelectedTabChanged(ShellTabViewModel? value)
    {
        ActiveTabId = value?.Id ?? "team";

        if (value is not null)
        {
            value.UnreadCount = 0;
        }

        OnPropertyChanged(nameof(CurrentTargetLabel));
        OnPropertyChanged(nameof(ComposerPlaceholder));
        OnPropertyChanged(nameof(ComposerEnabled));
        OnPropertyChanged(nameof(ComposerStatusText));
        OnPropertyChanged(nameof(VisibleFeedItems));
        SendInputCommand.NotifyCanExecuteChanged();
    }

    partial void OnActiveTabIdChanged(string value)
    {
        OnPropertyChanged(nameof(ComposerStatusText));
    }

    partial void OnComposerTextChanged(string value)
    {
        SendInputCommand.NotifyCanExecuteChanged();
    }

    partial void OnIsBusyChanged(bool value)
    {
        SendInputCommand.NotifyCanExecuteChanged();
    }

    partial void OnSelectedAdapterNameChanged(string value)
    {
        OnPropertyChanged(nameof(SelectedAdapterDisplayName));
        OnPropertyChanged(nameof(IsCodexSelected));
        OnPropertyChanged(nameof(IsCopilotSelected));
        OnPropertyChanged(nameof(IsClaudeSelected));
        OnPropertyChanged(nameof(IsAiderSelected));
        OnPropertyChanged(nameof(IsEchoSelected));
    }

    partial void OnWorkingDirectoryChanged(string value)
    {
        OnPropertyChanged(nameof(WindowTitle));
    }

    [RelayCommand(CanExecute = nameof(CanSendInput))]
    private async Task SendInputAsync()
    {
        if (SelectedTab is null)
        {
            return;
        }

        var text = ComposerText.Trim();
        if (text.Length == 0)
        {
            return;
        }

        IsBusy = true;
        await _engineShellClient.SendInputAsync(SelectedTab.Id, text);
        ComposerText = string.Empty;
        IsBusy = false;
    }

    [RelayCommand]
    private void Exit()
    {
        if (Application.Current?.ApplicationLifetime is IControlledApplicationLifetime controlledLifetime)
        {
            controlledLifetime.Shutdown();
        }
    }

    [RelayCommand]
    private async Task SelectAdapterAsync(string? adapterName)
    {
        if (string.IsNullOrWhiteSpace(adapterName) || IsBusy)
        {
            return;
        }

        IsBusy = true;
        try
        {
            await _engineShellClient.SetAdapterAsync(adapterName);
            UpdateAdapterSelection(adapterName);
            await LoadAsync(SelectedTab?.Id);
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private async Task ShowAboutAsync()
    {
        var activeWindow = Application.Current?.ApplicationLifetime switch
        {
            IClassicDesktopStyleApplicationLifetime desktop => desktop.Windows.FirstOrDefault(window => window.IsActive) ?? desktop.MainWindow,
            _ => null
        };

        if (activeWindow is null)
        {
            return;
        }

        var aboutWindow = new PortableWindow
        {
            Title = "About TeamMates",
            Width = 420,
            Height = 220,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Content = new TextBlock
            {
                Margin = new Thickness(20),
                TextWrapping = Avalonia.Media.TextWrapping.Wrap,
                Text =
                    $"TeamMates shell bridge\n\nAdapter: {SelectedAdapterDisplayName}\nConnection: {ConnectionState}\nTransport: {TransportVersion}\nFolder: {_engineShellClient.WorkingDirectory}"
            }
        };

        await aboutWindow.ShowDialog(activeWindow);
    }

    private bool CanSendInput()
    {
        return !IsBusy && ComposerEnabled && !string.IsNullOrWhiteSpace(ComposerText);
    }

    private async Task LoadAsync(string? preferredTabId = null)
    {
        WorkingDirectory = _engineShellClient.WorkingDirectory;
        var snapshot = await _engineShellClient.GetShellStateAsync();
        WorkingDirectory = _engineShellClient.WorkingDirectory;
        UpdateAdapterSelection(_engineShellClient.CurrentAdapterName);
        ApplySnapshot(snapshot, preferredTabId);
    }

    private void OnShellStateChanged(object? sender, ShellStateSnapshotDto snapshot)
    {
        _ = Dispatcher.UIThread.InvokeAsync(() => ApplySnapshot(snapshot, SelectedTab?.Id));
    }

    private void ApplySnapshot(ShellStateSnapshotDto snapshot, string? preferredTabId = null)
    {
        ConnectionState = snapshot.ConnectionState;
        TransportVersion = snapshot.TransportVersion;
        Tabs.Clear();
        foreach (var tab in snapshot.Tabs)
        {
            var viewModel = new ShellTabViewModel(
                tab.Id,
                tab.TargetKind,
                tab.DisplayName,
                tab.ActivityState,
                tab.ComposerEnabled,
                BuildComposerPlaceholder(tab.DisplayName),
                tab.ComposerDisabledReason,
                tab.UnreadCount);

            foreach (var feedItem in snapshot.FeedItems.Where(item => item.TargetId == tab.Id || tab.Id == "team"))
            {
                viewModel.FeedItems.Add(new FeedItemViewModel(
                    feedItem.Id,
                    feedItem.Title,
                    feedItem.Body,
                    feedItem.Timestamp.ToLocalTime().ToString("HH:mm"),
                    feedItem.Author,
                    feedItem.Status));
            }

            Tabs.Add(viewModel);
        }

        var activeTabId = preferredTabId ?? snapshot.ActiveTabId;
        SelectedTab = Tabs.FirstOrDefault(tab => tab.Id == activeTabId) ?? Tabs.FirstOrDefault();
    }

    private void UpdateAdapterSelection(string selectedAdapterName)
    {
        SelectedAdapterName = selectedAdapterName;
    }

    public async Task SelectWorkingDirectoryAsync(string workingDirectory)
    {
        if (string.IsNullOrWhiteSpace(workingDirectory) || IsBusy)
        {
            return;
        }

        IsBusy = true;
        try
        {
            await _engineShellClient.SetWorkingDirectoryAsync(workingDirectory);
            WorkingDirectory = _engineShellClient.WorkingDirectory;
            UpdateAdapterSelection(_engineShellClient.CurrentAdapterName);
            await LoadAsync("team");
        }
        finally
        {
            IsBusy = false;
        }
    }

    private static string BuildComposerPlaceholder(string displayName)
    {
        return $"Message {displayName}";
    }

    private bool IsAdapterSelected(string adapterName)
    {
        return string.Equals(SelectedAdapterName, adapterName, StringComparison.OrdinalIgnoreCase);
    }

    private static string GetAdapterDisplayName(string adapterName)
    {
        return adapterName.ToLowerInvariant() switch
        {
            "codex" => "Codex",
            "copilot" => "Copilot",
            "claude" => "Claude",
            "aider" => "Aider",
            "echo" => "Echo",
            _ => adapterName,
        };
    }
}
