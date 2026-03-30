using System;
using System.Collections.Generic;

namespace TeamMates.Contracts;

public enum ShellTargetKind
{
    Team,
    Agent,
}

public sealed record FeedItemDto(
    string Id,
    string TargetId,
    string Title,
    string Body,
    DateTimeOffset Timestamp,
    string? Author = null,
    string? Status = null);

public sealed record TabStateDto(
    string Id,
    ShellTargetKind TargetKind,
    string DisplayName,
    string ActivityState,
    bool ComposerEnabled,
    string? ComposerDisabledReason,
    int UnreadCount);

public sealed record ShellStateSnapshotDto(
    string ActiveTabId,
    string ConnectionState,
    string TransportVersion,
    IReadOnlyList<TabStateDto> Tabs,
    IReadOnlyList<FeedItemDto> FeedItems);
