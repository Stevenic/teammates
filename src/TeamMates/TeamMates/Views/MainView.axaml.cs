using System.Linq;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using TeamMates.ViewModels;

namespace TeamMates.Views;

public partial class MainView : UserControl
{
    public MainView()
    {
        InitializeComponent();
    }

    private async void OpenFolder_Click(object? sender, RoutedEventArgs e)
    {
        if (DataContext is not MainViewModel viewModel)
        {
            return;
        }

        var topLevel = TopLevel.GetTopLevel(this);
        var storageProvider = topLevel?.StorageProvider;
        if (storageProvider?.CanPickFolder != true)
        {
            return;
        }

        var suggestedStartLocation = string.IsNullOrWhiteSpace(viewModel.WorkingDirectory)
            ? null
            : await storageProvider.TryGetFolderFromPathAsync(viewModel.WorkingDirectory);

        var folders = await storageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
        {
            AllowMultiple = false,
            Title = "Select working folder",
            SuggestedStartLocation = suggestedStartLocation,
        });

        var selectedPath = folders?.FirstOrDefault()?.TryGetLocalPath();
        if (string.IsNullOrWhiteSpace(selectedPath))
        {
            return;
        }

        await viewModel.SelectWorkingDirectoryAsync(selectedPath);
    }
}
