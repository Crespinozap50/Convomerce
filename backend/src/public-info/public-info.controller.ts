import { Controller, Get, Header } from '@nestjs/common';

const PRIVACY_POLICY_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Privacy Policy — Commerce Assistant Dev</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0 auto; max-width: 760px; padding: 32px 20px 64px; line-height: 1.6; }
      h1, h2 { line-height: 1.2; }
      .notice { border-left: 4px solid #d97706; padding: 12px 16px; background: color-mix(in srgb, #d97706 12%, transparent); }
    </style>
  </head>
  <body>
    <main>
      <h1>Commerce Assistant Dev Privacy Policy</h1>
      <p><strong>Last updated:</strong> August 3, 2026.</p>
      <p class="notice"><strong>Test environment:</strong> this application is a technical prototype under development and is not a production commercial service.</p>

      <h2>Data processed</h2>
      <p>During authorized tests, the application may receive the WhatsApp account identifier, the profile name provided by WhatsApp, messages sent to the test number, and technical delivery statuses.</p>

      <h2>Purpose</h2>
      <p>This data is used exclusively to verify webhook reception, maintain test-conversation context, process requested responses, and validate the prototype's technical operation and security.</p>

      <h2>Retention and security</h2>
      <p>Data is stored temporarily in a local development environment with tenant-isolation controls. It is deleted when testing ends or earlier upon a participant's request. Test data is not used for advertising or profiling.</p>

      <h2>Sharing and sale</h2>
      <p>The application does not sell personal data. Data only passes through technical providers required for testing, including Meta's WhatsApp Business Platform.</p>

      <h2>Access or deletion requests</h2>
      <p>A test participant may request access or deletion by contacting the administrator who provided access through the same channel used to coordinate the test. The request will be handled manually and associated data will be deleted from the local environment.</p>

      <h2>Changes</h2>
      <p>This temporary policy must be replaced by a stable policy with formal contact details and a permanent URL before the service is offered in production.</p>
    </main>
  </body>
</html>`;

@Controller()
export class PublicInfoController {
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  privacyPolicy(): string {
    return PRIVACY_POLICY_HTML;
  }
}
