using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.ObjectModel;
using TeamMates.Contracts;
using TeamMates.Services;

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
        Tabs = [];
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

    public string CurrentTargetLabel => SelectedTab?.DisplayName ?? "TEAM";

    public string ComposerPlaceholder => SelectedTab?.ComposerPlaceholder ?? "Message TEAM";

    public bool ComposerEnabled => SelectedTab?.ComposerEnabled ?? false;

    public string ComposerStatusText =>
        ComposerEnabled
            ? $"Routing to {CurrentTargetLabel} with explicit targetId `{ActiveTabId}`."
            : SelectedTab?.ComposerDisabledReason ?? "Input is unavailable for the selected target.";

    public ObservableCollection<FeedItemViewModel> VisibleFeedItems => SelectedTab?.FeedItems ?? [];

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
        await LoadAsync(SelectedTab.Id);
        IsBusy = false;
    }

    private bool CanSendInput()
    {
        return !IsBusy && ComposerEnabled && !string.IsNullOrWhiteSpace(ComposerText);
    }

    private async Task LoadAsync(string? preferredTabId = null)
    {
        var snapshot = await _engineShellClient.GetShellStateAsync();

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

    private static string BuildComposerPlaceholder(string displayName)
    {
        return $"Message {displayName}";
    }
}
