using Avalonia;
using Avalonia.Controls;
using System.Windows.Input;

namespace TeamMates.Views;

public partial class AgentActivityPaneView : UserControl
{
    public static readonly StyledProperty<string> ComposerTextProperty =
        AvaloniaProperty.Register<AgentActivityPaneView, string>(nameof(ComposerText), string.Empty, defaultBindingMode: Avalonia.Data.BindingMode.TwoWay);

    public static readonly StyledProperty<string> ComposerStatusTextProperty =
        AvaloniaProperty.Register<AgentActivityPaneView, string>(nameof(ComposerStatusText), string.Empty);

    public static readonly StyledProperty<string> ConnectionStateProperty =
        AvaloniaProperty.Register<AgentActivityPaneView, string>(nameof(ConnectionState), string.Empty);

    public static readonly StyledProperty<string> TransportVersionProperty =
        AvaloniaProperty.Register<AgentActivityPaneView, string>(nameof(TransportVersion), string.Empty);

    public static readonly StyledProperty<ICommand?> SendInputCommandProperty =
        AvaloniaProperty.Register<AgentActivityPaneView, ICommand?>(nameof(SendInputCommand));

    public AgentActivityPaneView()
    {
        InitializeComponent();
    }

    public string ComposerText
    {
        get => GetValue(ComposerTextProperty);
        set => SetValue(ComposerTextProperty, value);
    }

    public string ComposerStatusText
    {
        get => GetValue(ComposerStatusTextProperty);
        set => SetValue(ComposerStatusTextProperty, value);
    }

    public string ConnectionState
    {
        get => GetValue(ConnectionStateProperty);
        set => SetValue(ConnectionStateProperty, value);
    }

    public string TransportVersion
    {
        get => GetValue(TransportVersionProperty);
        set => SetValue(TransportVersionProperty, value);
    }

    public ICommand? SendInputCommand
    {
        get => GetValue(SendInputCommandProperty);
        set => SetValue(SendInputCommandProperty, value);
    }
}
