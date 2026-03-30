using CommunityToolkit.Mvvm.ComponentModel;

namespace TeamMates.ViewModels;

public partial class AdapterOptionViewModel : ObservableObject
{
    public AdapterOptionViewModel(string name, string displayName, bool isSelected)
    {
        Name = name;
        DisplayName = displayName;
        _isSelected = isSelected;
    }

    public string Name { get; }

    public string DisplayName { get; }

    [ObservableProperty]
    private bool _isSelected;
}
