/** Company branding used in emails (from Settings). */
export interface MailBrand {
  name: string;
  portalName: string;
  primaryColor: string;
}

/** Darker shade of a #RRGGBB colour, for the email header. */
function darken(hex: string, factor = 0.7): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const c = [16, 8, 0].map((s) => Math.round(((n >> s) & 255) * factor).toString(16).padStart(2, "0"));
  return "#" + c.join("");
}

export interface MailContent {
  subject: string;
  html: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const p = (text: string) => `<p style="margin:0 0 12px">${text}</p>`;

function button(brand: MailBrand, url: string, label: string) {
  return (
    `<p style="margin:20px 0"><a href="${esc(url)}" style="background:${esc(brand.primaryColor)};color:#fff;padding:10px 18px;` +
    `text-decoration:none;border-radius:6px;display:inline-block">${esc(label)}</a></p>` +
    `<p style="font-size:12px;color:#666">If the button does not work, open this link: <a href="${esc(url)}">${esc(url)}</a></p>`
  );
}

/** Large one-time code, easy to read and copy. */
const OTP_MINUTES = 10;
const codeBox = (brand: MailBrand, code: string) =>
  `<p style="margin:20px 0;font-size:32px;font-weight:bold;letter-spacing:8px;font-family:Consolas,Menlo,monospace;color:${esc(brand.primaryColor)}">${esc(code)}</p>`;

const reasonBox = (reason: string) =>
  `<div style="background:#F4F6F8;border-left:4px solid #94A3B8;padding:10px 14px;margin:12px 0">${esc(reason)}</div>`;

function layout(brand: MailBrand, heading: string, body: string): string {
  const dark = esc(darken(brand.primaryColor));
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#222;font-size:14px;line-height:1.5">` +
    `<div style="background:${dark};color:#fff;padding:16px 24px;font-size:18px;font-weight:bold">${esc(brand.name)}</div>` +
    `<div style="padding:24px;border:1px solid #e5e5e5;border-top:0"><h2 style="color:${dark};margin:0 0 16px;font-size:20px">${esc(heading)}</h2>${body}</div>` +
    `<div style="padding:12px 24px;color:#888;font-size:12px">This is an automated message from the ${esc(brand.name)} ${esc(brand.portalName)}.</div></div>`
  );
}

export const mailTemplates = {
  verificationCode: (brand: MailBrand, name: string, code: string): MailContent => ({
    subject: `${code} is your ${brand.name} verification code`,
    html: layout(brand, "Verify your email",
      p(`Dear ${esc(name)},`) +
      p(`Thank you for registering your agency with ${esc(brand.name)}. Enter this code to verify your email address:`) +
      codeBox(brand, code) + p(`The code is valid for ${OTP_MINUTES} minutes. If you did not register, you can ignore this email.`)),
  }),

  loginCode: (brand: MailBrand, name: string, code: string): MailContent => ({
    subject: `${code} is your ${brand.name} login code`,
    html: layout(brand, "Your login code",
      p(`Dear ${esc(name)},`) + p("Enter this code to finish logging in:") + codeBox(brand, code) +
      p(`The code is valid for ${OTP_MINUTES} minutes. If you did not try to log in, change your password right away.`)),
  }),

  applicationReceived: (brand: MailBrand, name: string): MailContent => ({
    subject: "Your agent application has been received",
    html: layout(brand, "Application received",
      p(`Dear ${esc(name)},`) +
      p("Your email is verified and your agency application is now under review. We will email you as soon as our team has reviewed it.")),
  }),

  newRegistrationAdmin: (brand: MailBrand, agencyName: string, city: string, url: string): MailContent => ({
    subject: `Agent application waiting for review: ${agencyName}`,
    html: layout(brand, "Agent application waiting for review",
      p(`<b>${esc(agencyName)}</b> (${esc(city)}) is waiting for review.`) + button(brand, url, "Review application")),
  }),

  approved: (brand: MailBrand, name: string, agentCode: string, loginUrl: string): MailContent => ({
    subject: `Your agency is approved – Agent ID ${agentCode}`,
    html: layout(brand, "Welcome aboard!",
      p(`Dear ${esc(name)},`) +
      p(`Your agency has been approved. Your Agent ID is <b>${esc(agentCode)}</b>.`) +
      p("You can now log in to the agent portal.") + button(brand, loginUrl, "Log in")),
  }),

  rejected: (brand: MailBrand, name: string, reason: string): MailContent => ({
    subject: "Update on your agent application",
    html: layout(brand, "Application not approved",
      p(`Dear ${esc(name)},`) +
      p("We are unable to approve your agency application at this time for the following reason:") + reasonBox(reason) +
      p("If you have questions, please contact our sales team.")),
  }),

  informationRequired: (brand: MailBrand, name: string, reason: string, url: string): MailContent => ({
    subject: "More information needed for your application",
    html: layout(brand, "More information required",
      p(`Dear ${esc(name)},`) +
      p("Our team needs more information before your application can be approved:") + reasonBox(reason) +
      p("Please log in, update your details or upload the documents, and resubmit your application.") + button(brand, url, "Update application")),
  }),

  reopened: (brand: MailBrand, name: string): MailContent => ({
    subject: "Your agent application is under review again",
    html: layout(brand, "Application reopened", p(`Dear ${esc(name)},`) + p("Your agency application has been reopened and is under review again.")),
  }),

  suspended: (brand: MailBrand, name: string, reason: string): MailContent => ({
    subject: "Your agent account has been suspended",
    html: layout(brand, "Account suspended",
      p(`Dear ${esc(name)},`) + p("Your agent account has been temporarily suspended for the following reason:") + reasonBox(reason) +
      p("Please contact our team to resolve this.")),
  }),

  reactivated: (brand: MailBrand, name: string, loginUrl: string): MailContent => ({
    subject: "Your agent account is active again",
    html: layout(brand, "Account reactivated", p(`Dear ${esc(name)},`) + p("Your agent account has been reactivated. You can log in again.") + button(brand, loginUrl, "Log in")),
  }),

  deactivated: (brand: MailBrand, name: string, reason: string): MailContent => ({
    subject: "Your agent account has been closed",
    html: layout(brand, "Account deactivated", p(`Dear ${esc(name)},`) + p("Your agent account has been deactivated:") + reasonBox(reason)),
  }),

  passwordResetCode: (brand: MailBrand, name: string, code: string): MailContent => ({
    subject: `${code} is your ${brand.name} password reset code`,
    html: layout(brand, "Reset your password",
      p(`Dear ${esc(name)},`) + p("We received a request to reset your password. Enter this code to choose a new password:") + codeBox(brand, code) +
      p(`The code is valid for ${OTP_MINUTES} minutes. If you did not request this, you can ignore this email; your password will not change.`)),
  }),

  passwordChanged: (brand: MailBrand, name: string): MailContent => ({
    subject: "Your password was changed",
    html: layout(brand, "Password changed",
      p(`Dear ${esc(name)},`) +
      p("Your password was just changed and your other sessions were logged out. If this was not you, contact us immediately.")),
  }),

  bookingUpdate: (brand: MailBrand, name: string, reference: string, statusLabel: string, reason: string | null, url: string): MailContent => ({
    subject: `Booking ${reference}: ${statusLabel}`,
    html: layout(brand, `Booking ${reference}`,
      p(`Dear ${esc(name)},`) +
      p(`The status of your booking is now <b>${esc(statusLabel)}</b>.`) +
      (reason ? reasonBox(reason) : "") +
      button(brand, url, "View booking")),
  }),

  bookingForOperations: (brand: MailBrand, headline: string, reference: string, agency: string, packageName: string, url: string): MailContent => ({
    subject: `${headline}: ${reference}`,
    html: layout(brand, headline,
      p(`<b>${esc(reference)}</b> · ${esc(packageName)}`) + p(`Agency: ${esc(agency)}`) + button(brand, url, "Open booking")),
  }),

  bookingMessage: (brand: MailBrand, reference: string, from: string, message: string, url: string): MailContent => ({
    subject: `New message on booking ${reference}`,
    html: layout(brand, `Message on booking ${reference}`,
      p(`From <b>${esc(from)}</b>:`) + reasonBox(message) + button(brand, url, "Reply")),
  }),

  staffInvite: (brand: MailBrand, name: string, url: string): MailContent => ({
    subject: `You have been invited to the ${brand.name} admin portal`,
    html: layout(brand, "Set up your account",
      p(`Dear ${esc(name)},`) +
      p("An account has been created for you on the admin portal. Set your password to get started. This link is valid for 72 hours.") +
      button(brand, url, "Set password")),
  }),

  /** To an agency: something changed on its account (payment verified, charge, credit note…). */
  accountUpdate: (brand: MailBrand, name: string, heading: string, message: string, note: string | null, url: string): MailContent => ({
    subject: heading,
    html: layout(brand, heading,
      p(`Dear ${esc(name)},`) + p(esc(message)) + (note ? reasonBox(note) : "") + button(brand, url, "View account")),
  }),

  /** To an agency: a general notice (new package, price update, announcement, balance reminder). */
  notice: (brand: MailBrand, name: string, heading: string, message: string, url: string, buttonLabel: string): MailContent => ({
    subject: heading,
    html: layout(brand, heading,
      p(`Dear ${esc(name)},`) + message.split(/\n+/).map((line) => p(esc(line))).join("") + button(brand, url, buttonLabel)),
  }),

  /** To finance staff: a payment or request is waiting. */
  financeForStaff: (brand: MailBrand, headline: string, lines: string[], url: string): MailContent => ({
    subject: headline,
    html: layout(brand, headline, lines.map((l) => p(esc(l))).join("") + button(brand, url, "Open")),
  }),
};
