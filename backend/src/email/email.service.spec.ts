import { EmailService } from "./email.service";

const sendMail = jest.fn();
const createTransport = jest.fn((_options: unknown) => ({ sendMail }));
jest.mock("nodemailer", () => ({ createTransport: (options: unknown) => createTransport(options) }));

describe("EmailService", () => {
  beforeEach(() => {
    sendMail.mockReset();
    createTransport.mockClear();
  });

  function config(overrides: Record<string, string | number> = {}) {
    const values: Record<string, string | number> = {
      EMAIL_FROM_ADDRESS: "onboarding@resend.dev",
      SMTP_HOST: "localhost",
      SMTP_PORT: 51025,
      SMTP_SECURE: "false",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      ...overrides,
    };
    return { get: jest.fn((key: string) => values[key]) } as never;
  }

  it("sends without SMTP auth when no user/password is configured (MailHog locally)", async () => {
    new EmailService(config());

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "localhost", port: 51025, secure: false, auth: undefined }),
    );
  });

  it("includes SMTP auth when a user is configured (Resend's SMTP relay in production)", async () => {
    new EmailService(config({ SMTP_USER: "resend", SMTP_PASSWORD: "re_real_api_key" }));

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: "resend", pass: "re_real_api_key" } }),
    );
  });

  it("sends the message with the configured from-address", async () => {
    sendMail.mockResolvedValue({});
    const service = new EmailService(config());

    await service.send("invitee@example.com", "Subject", "text body", "<p>html body</p>");

    expect(sendMail).toHaveBeenCalledWith({
      from: "onboarding@resend.dev",
      to: "invitee@example.com",
      subject: "Subject",
      text: "text body",
      html: "<p>html body</p>",
    });
  });

  it("does not throw when the underlying transport fails — a bounced/unreachable mail server must not break the caller's own action", async () => {
    sendMail.mockRejectedValue(new Error("connection refused"));
    const service = new EmailService(config());

    await expect(service.send("invitee@example.com", "Subject", "text", "<p>html</p>")).resolves.toBeUndefined();
  });
});
