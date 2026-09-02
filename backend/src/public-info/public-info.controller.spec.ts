import { PublicInfoController } from './public-info.controller';

describe('PublicInfoController', () => {
  it('publishes a temporary policy without secrets', () => {
    const html = new PublicInfoController().privacyPolicy();

    expect(html).toContain('Privacy Policy');
    expect(html).toContain('Test environment');
    expect(html).toContain('Access or deletion requests');
    expect(html).not.toContain('WHATSAPP_ACCESS_TOKEN');
  });
});
