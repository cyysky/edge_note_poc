import { ChatView } from '@/components/chat-view';

export const metadata = {
  title: 'Chat · Displayer',
};

export default function ChatPage() {
  return (
    <main className="page" id="main">
      <header className="page-header">
        <div>
          <h1>Chat</h1>
          <p>
            A local conversation with LFM3-Omni. It can call notes tools on its own, listen to a
            recording and look at a picture. Everything runs on this machine.
          </p>
        </div>
      </header>

      <ChatView />
    </main>
  );
}
