export {
  createEmailSender,
  EmailError,
  resendSender,
  smtpSender,
  type EmailConfig,
  type EmailMessage,
  type EmailSender,
} from './sender';
export { resetPasswordEmail, verificationEmail } from './templates';
