using CommunityToolkit.Mvvm.ComponentModel;
using Avalonia.Media.Imaging;
using System;
using System.Collections.Concurrent;
using System.Collections.ObjectModel;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using TeamMates.Contracts;

namespace TeamMates.ViewModels;

public partial class ShellTabViewModel : ObservableObject
{
    public ShellTabViewModel(
        string id,
        ShellTargetKind targetKind,
        string displayName,
        string activityState,
        bool composerEnabled,
        string composerPlaceholder,
        string? composerDisabledReason,
        int unreadCount)
    {
        Id = id;
        TargetKind = targetKind;
        DisplayName = displayName;
        AvatarImage = LoadAvatarAsync(id, displayName, targetKind);
        ActivityState = activityState;
        ComposerEnabled = composerEnabled;
        ComposerPlaceholder = composerPlaceholder;
        ComposerDisabledReason = composerDisabledReason ?? string.Empty;
        FeedItems = [];
        UnreadCount = unreadCount;
    }

    public string Id { get; }

    public ShellTargetKind TargetKind { get; }

    public string DisplayName { get; }

    public Task<Bitmap?> AvatarImage { get; }

    [ObservableProperty]
    private string _activityState;

    [ObservableProperty]
    private bool _composerEnabled;

    [ObservableProperty]
    private string _composerPlaceholder;

    [ObservableProperty]
    private string _composerDisabledReason;

    [ObservableProperty]
    private int _unreadCount;

    public ObservableCollection<FeedItemViewModel> FeedItems { get; }

    public bool HasUnread => UnreadCount > 0;

    public string ActivityGlyph =>
        ActivityState switch
        {
            "running" => "●",
            "blocked" => "▲",
            "error" => "■",
            "active" => "●",
            _ => "○",
        };

    partial void OnUnreadCountChanged(int value)
    {
        OnPropertyChanged(nameof(HasUnread));
    }

    private static readonly HttpClient AvatarHttpClient = new();

    private static readonly ConcurrentDictionary<string, Task<Bitmap?>> AvatarCache = new(StringComparer.OrdinalIgnoreCase);

    private static Task<Bitmap?> LoadAvatarAsync(string id, string displayName, ShellTargetKind targetKind)
    {
        var avatarUri = BuildAvatarUri(id, displayName, targetKind);
        return AvatarCache.GetOrAdd(avatarUri.AbsoluteUri, static uri => DownloadBitmapAsync(new Uri(uri, UriKind.Absolute)));
    }

    private static Uri BuildAvatarUri(string id, string displayName, ShellTargetKind targetKind)
    {
        var seed =
            targetKind == ShellTargetKind.Agent && id.StartsWith("agent:", StringComparison.OrdinalIgnoreCase)
                ? id["agent:".Length..]
                : displayName.TrimStart('@');

        if (string.IsNullOrWhiteSpace(seed))
        {
            seed = id;
        }

        return new Uri($"https://robohash.org/{Uri.EscapeDataString(seed)}.png?size=96x96", UriKind.Absolute);
    }

    private static async Task<Bitmap?> DownloadBitmapAsync(Uri avatarUri)
    {
        try
        {
            var bytes = await AvatarHttpClient.GetByteArrayAsync(avatarUri);
            return new Bitmap(new MemoryStream(bytes));
        }
        catch
        {
            return null;
        }
    }
}
