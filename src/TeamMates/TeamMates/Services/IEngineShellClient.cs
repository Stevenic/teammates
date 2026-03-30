using System.Threading;
using System.Threading.Tasks;
using TeamMates.Contracts;

namespace TeamMates.Services;

public interface IEngineShellClient
{
    Task<ShellStateSnapshotDto> GetShellStateAsync(CancellationToken cancellationToken = default);

    Task SendInputAsync(string targetId, string text, CancellationToken cancellationToken = default);
}
