using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using TeamMates.Contracts;

namespace TeamMates.Services;

public sealed class DemoEngineShellClient : IEngineShellClient
{
    private readonly List<TabStateDto> _tabs =
    [
        new("team", ShellTargetKind.Team, "TEAM", "active", true, null, 0),
        new("agent:beacon", ShellTargetKind.Agent, "@beacon", "running", true, null, 2),
        new("agent:scribe", ShellTargetKind.Agent, "@scribe", "idle", true, null, 0),
        new("agent:lexicon", ShellTargetKind.Agent, "@lexicon", "blocked", false, "Waiting on prompt review approval", 1),
        new("agent:pipeline", ShellTargetKind.Agent, "@pipeline", "error", true, null, 0),
    ];

    private readonly List<FeedItemDto> _feedItems =
    [
        new("feed-001", "team", "Shell connected", "Bridge transport v1 ready. Startup snapshot restored the TEAM aggregate view.", DateTimeOffset.Now.AddMinutes(-12), "system", "connected"),
        new("feed-002", "agent:beacon", "Transport slice", "Drafting the tab-scoped shell state and explicit target routing contract.", DateTimeOffset.Now.AddMinutes(-10), "@beacon", "running"),
        new("feed-003", "agent:scribe", "Shell UX spec", "Captured TEAM-first tab order, scoped activity views, and one shared composer.", DateTimeOffset.Now.AddMinutes(-8), "@scribe", "idle"),
        new("feed-004", "agent:lexicon", "Prompt review blocked", "Waiting for approval before updating shell-facing prompt affordances.", DateTimeOffset.Now.AddMinutes(-6), "@lexicon", "blocked"),
        new("feed-005", "agent:pipeline", "Desktop packaging warning", "Build artifact cache is stale; retry queued after clean output folder reset.", DateTimeOffset.Now.AddMinutes(-4), "@pipeline", "error"),
        new("feed-006", "team", "Roster update", "TEAM tab is aggregating feed items from all agent tabs without text scraping.", DateTimeOffset.Now.AddMinutes(-2), "system", "info"),
    ];

    public Task<ShellStateSnapshotDto> GetShellStateAsync(CancellationToken cancellationToken = default)
    {
        var snapshot = new ShellStateSnapshotDto(
            ActiveTabId: "team",
            ConnectionState: "Connected",
            TransportVersion: "v1",
            Tabs: _tabs.ToArray(),
            FeedItems: _feedItems.ToArray());

        return Task.FromResult(snapshot);
    }

    public Task SendInputAsync(string targetId, string text, CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.Now;
        _feedItems.Add(new FeedItemDto(
            Id: $"feed-{Guid.NewGuid():N}",
            TargetId: targetId,
            Title: $"Input routed to {targetId}",
            Body: text,
            Timestamp: now,
            Author: "tomlm",
            Status: "sent"));

        _feedItems.Add(new FeedItemDto(
            Id: $"feed-{Guid.NewGuid():N}",
            TargetId: "team",
            Title: "Routed input",
            Body: $"Sent to `{targetId}` via explicit target-based routing.",
            Timestamp: now,
            Author: "system",
            Status: "info"));

        return Task.CompletedTask;
    }
}
