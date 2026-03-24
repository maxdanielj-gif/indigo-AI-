import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { sendEmail } from '../services/emailService';

const EmailComposer: React.FC = () => {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { googleClientId, googleClientSecret, addToast, userId } = useApp();

  React.useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/google/status', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setIsAuthenticated(data.isAuthenticated);
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
      }
    };
    checkAuth();
  }, []);

  const connectGmail = async () => {
    try {
      const res = await fetch(`/api/auth/google/url?clientId=${googleClientId}&clientSecret=${googleClientSecret}&userId=${userId}`, { 
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      const { url } = await res.json();
      window.open(url, '_blank', 'width=600,height=700');
    } catch (error) {
      console.error('Error initiating auth:', error);
      addToast({ title: "Error", message: "Failed to initiate authentication.", type: "error" });
    }
  };

  const handleSendEmail = async () => {
    setSending(true);
    addToast({ title: "Email", message: "Preparing to send your email...", type: "info" });
    try {
      await sendEmail(to, subject, body, googleClientId, googleClientSecret);
      addToast({ title: "Success", message: "Email sent successfully!", type: "success" });
      setTo('');
      setSubject('');
      setBody('');
    } catch (error) {
      console.error('Error sending email:', error);
      addToast({ title: "Error", message: "Failed to send email.", type: "error" });
    } finally {
      setSending(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="p-4 border border-indigo-200 dark:border-indigo-800 rounded-lg shadow-sm bg-indigo-100 dark:bg-indigo-900">
        <h2 className="text-lg font-semibold mb-4 text-indigo-900 dark:text-indigo-100">Gmail Integration</h2>
        <p className="mb-4 text-indigo-600 dark:text-indigo-400">Please connect your Gmail account to send emails.</p>
        <button
          onClick={connectGmail}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          Connect Gmail
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 border border-indigo-200 dark:border-indigo-800 rounded-lg shadow-sm bg-indigo-100 dark:bg-indigo-900">
      <h2 className="text-lg font-semibold mb-4 text-indigo-900 dark:text-indigo-100">Compose Email</h2>
      <input
        type="email"
        placeholder="To"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="w-full p-2 mb-2 border border-indigo-200 dark:border-indigo-800 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100"
      />
      <input
        type="text"
        placeholder="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="w-full p-2 mb-2 border border-indigo-200 dark:border-indigo-800 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100"
      />
      <textarea
        placeholder="Body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="w-full p-2 mb-2 border border-indigo-200 dark:border-indigo-800 rounded bg-indigo-50 dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100 h-32"
      />
      <button
        onClick={handleSendEmail}
        disabled={sending}
        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:bg-indigo-200 dark:disabled:bg-indigo-800 disabled:text-indigo-600 dark:disabled:text-indigo-400"
      >
        {sending ? 'Sending...' : 'Send Email'}
      </button>
    </div>
  );
};

export default EmailComposer;
