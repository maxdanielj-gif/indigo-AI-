import React from 'react';
import EmailComposer from '../components/EmailComposer';

const EmailScreen: React.FC = () => {
  return (
    <div className="p-4 bg-transparent transition-colors duration-500">
      <h1 className="text-2xl font-bold mb-4">Gmail Integration</h1>
      <EmailComposer />
    </div>
  );
};

export default EmailScreen;
