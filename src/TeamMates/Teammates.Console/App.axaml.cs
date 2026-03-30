using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using TeamMates.Views;

namespace Teammates.Console;

public partial class App : TeamMates.App
{
    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

}