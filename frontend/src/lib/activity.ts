/** Short past-tense phrase for a timeline event type, used in activity feeds ("Erin <phrase> <incident>"). */
export function activityVerb(eventType: string): string {
  switch (eventType) {
    case 'incident.created':
      return 'opened';
    case 'incident.status_changed':
      return 'changed the status of';
    case 'incident.assigned':
      return 'reassigned';
    case 'incident.updated':
      return 'updated';
    case 'incident.comment_added':
      return 'commented on';
    case 'incident.deployment_linked':
      return 'linked a deployment to';
    case 'ai.analysis.requested':
      return 'requested an AI analysis of';
    case 'ai.analysis.started':
      return 'started an AI analysis of';
    case 'ai.analysis.completed':
      return 'finished an AI analysis of';
    case 'ai.analysis.failed':
      return 'had an AI analysis fail on';
    default:
      return 'acted on';
  }
}
