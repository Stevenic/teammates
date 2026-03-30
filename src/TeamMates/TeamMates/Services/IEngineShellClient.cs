using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using TeamMates.Contracts;

namespace TeamMates.Services;

public interface IEngineShellClient
{
    event EventHandler<ShellStateSnapshotDto>? ShellStateChanged;

    string CurrentAdapterName { get; }

    string WorkingDirectory { get; }

    IReadOnlyList<ShellAdapterOption> AvailableAdapters { get; }

    Task<ShellStateSnapshotDto> GetShellStateAsync(CancellationToken cancellationToken = default);

    Task SendInputAsync(string targetId, string text, CancellationToken cancellationToken = default);

    Task SetAdapterAsync(string adapterName, CancellationToken cancellationToken = default);

    Task SetWorkingDirectoryAsync(string workingDirectory, CancellationToken cancellationToken = default);
}
