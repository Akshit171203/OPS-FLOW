/** Copy-paste setup for each way of sending data in. `$` + `{{` is written out so GitHub expressions survive. */
export interface Snippet {
  id: string;
  title: string;
  description: string;
  language: string;
  code: string;
}

export function buildSnippets(baseUrl: string, key: string, serviceSlug: string): Snippet[] {
  const GH = (name: string) => '$' + '{{ secrets.' + name + ' }}';
  return [
    {
      id: 'deploy',
      title: 'Report deployments (GitHub Actions)',
      description:
        'Add this step after your deploy. OpsFlow then knows what changed and when, and links it to incidents that start soon after.',
      language: 'yaml',
      code: [
        '- name: Tell OpsFlow about this deployment',
        '  if: success()',
        '  run: |',
        `    curl -fsS -X POST ${baseUrl}/api/deployments \\`,
        `      -H "Authorization: Bearer ${GH('OPSFLOW_API_KEY')}" \\`,
        '      -H "Content-Type: application/json" \\',
        `      -d '{"service":"${serviceSlug}","version":"'"$GITHUB_REF_NAME"'","commitSha":"'"$GITHUB_SHA"'","environment":"production"}'`,
        '',
        `# Store the key as a repository secret named OPSFLOW_API_KEY.`,
      ].join('\n'),
    },
    {
      id: 'alert',
      title: 'Send an alert (any tool)',
      description:
        'Opens an incident. Sending the same alert again attaches to the open incident instead of creating a duplicate; status "resolved" adds a note.',
      language: 'bash',
      code: [
        `curl -X POST ${baseUrl}/api/integrations/alerts \\`,
        `  -H "Authorization: Bearer ${key}" \\`,
        '  -H "Content-Type: application/json" \\',
        "  -d '{",
        `    "service": "${serviceSlug}",`,
        '    "title": "High error rate on checkout",',
        '    "severity": "critical",',
        '    "description": "5xx responses above 5% for 5 minutes",',
        '    "fingerprint": "checkout-error-rate",',
        '    "status": "firing"',
        "  }'",
      ].join('\n'),
    },
    {
      id: 'alertmanager',
      title: 'Prometheus Alertmanager',
      description:
        'Point a receiver at OpsFlow. Alerts need a "service" (or "job") label so OpsFlow knows which service they belong to.',
      language: 'yaml',
      code: [
        'receivers:',
        '  - name: opsflow',
        '    webhook_configs:',
        `      - url: ${baseUrl}/api/integrations/alertmanager`,
        '        send_resolved: true',
        '        http_config:',
        '          authorization:',
        '            type: Bearer',
        `            credentials: ${key}`,
        '',
        'route:',
        '  receiver: opsflow',
      ].join('\n'),
    },
    {
      id: 'grafana',
      title: 'Grafana alerting',
      description:
        'In Grafana: Alerting, Contact points, add a Webhook contact point with these values.',
      language: 'text',
      code: [
        `URL:            ${baseUrl}/api/integrations/alertmanager?source=grafana`,
        'HTTP method:    POST',
        'Authorization header scheme:  Bearer',
        `Authorization header credentials:  ${key}`,
        '',
        `Give your alert rules a "service" label (for example service=${serviceSlug}).`,
      ].join('\n'),
    },
    {
      id: 'logs',
      title: 'Send logs',
      description:
        'Send one log, or a batch of up to 500. Logs attach to the service, and show up on its incidents.',
      language: 'bash',
      code: [
        `curl -X POST ${baseUrl}/api/logs \\`,
        `  -H "Authorization: Bearer ${key}" \\`,
        '  -H "Content-Type: application/json" \\',
        '  -d \'{"logs":[',
        `    {"service":"${serviceSlug}","level":"ERROR","message":"Connection pool exhausted","requestId":"req-123"},`,
        `    {"service":"${serviceSlug}","level":"WARN","message":"Slow query: 2400ms"}`,
        "  ]}'",
      ].join('\n'),
    },
    {
      id: 'metrics',
      title: 'Send metrics',
      description:
        'A snapshot of how the service is doing. The newest snapshot sets the service health shown across OpsFlow.',
      language: 'javascript',
      code: [
        `await fetch('${baseUrl}/api/metrics', {`,
        "  method: 'POST',",
        `  headers: { Authorization: 'Bearer ${key}', 'Content-Type': 'application/json' },`,
        '  body: JSON.stringify({',
        `    service: '${serviceSlug}',`,
        '    errorRate: 0.34,      // fraction of failed requests, 0 to 1',
        '    latencyMs: 5200,',
        '    requestsPerMin: 410,',
        '  }),',
        '});',
      ].join('\n'),
    },
  ];
}
