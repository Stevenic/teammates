using CommunityToolkit.Mvvm.ComponentModel;

namespace TeamMates.ViewModels;

public partial class FeedItemViewModel : ObservableObject
{
    public FeedItemViewModel(string id, string title, string body, string timestampText, string? author, string? status)
    {
        Id = id;
        Title = title;
        Body = body;
        TimestampText = timestampText;
        Author = author ?? string.Empty;
        Status = status ?? string.Empty;
    }

    public string Id { get; }

    public string Title { get; }

    public string Body { get; }

    public string TimestampText { get; }

    public string Author { get; }

    public string Status { get; }
}
