export const sendEmail = async (to: string, subject: string, body: string, googleClientId: string | null, googleClientSecret: string | null) => {
  const response = await fetch('/api/gmail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      to,
      subject,
      body,
      clientId: googleClientId,
      clientSecret: googleClientSecret
    }),
  });
  
  if (!response.ok) {
    throw new Error('Failed to send email');
  }
  
  return await response.json();
};
