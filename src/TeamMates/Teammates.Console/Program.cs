using Avalonia;
using Consolonia;
using Consolonia.ManagedWindows.Storage;

namespace Teammates.Console
{
    public static class Program
    {
        private static void Main(string[] args)
        {
            BuildAvaloniaApp()
                .StartWithConsoleLifetime(args);
        }

        public static AppBuilder BuildAvaloniaApp()
        {
            return AppBuilder.Configure<App>()
                .UseConsolonia()
                .UseConsoloniaStorage()
                .UseAutoDetectedConsole()
                .LogToException();
        }
    }
}