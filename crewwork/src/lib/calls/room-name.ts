export function buildCallRoomName(workspaceId: string, channelId: string): string {
  return `${workspaceId}-${channelId}`
}

export function jitsiRoomName(rawRoomName: string): string {
  return `CrewWork-${rawRoomName}`
}
