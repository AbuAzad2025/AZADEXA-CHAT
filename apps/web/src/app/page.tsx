export default function Home() {
  return (
    <main className="p-8">
      <div className="art-brush-ribbon mb-8" />
      <h1 className="text-4xl font-bold mb-4">ZestChat</h1>
      <p className="text-xl mb-2">Chat that gets you. Anywhere. Any language.</p>
      <p className="text-lg mb-8" lang="ar" dir="rtl">دردشة عالمية، ذكاء يفهمك.</p>
      
      <div className="painted-card p-6 max-w-sm">
        <h2 className="text-2xl font-semibold mb-2">Zesty AI</h2>
        <p className="mb-4">Your friendly AI assistant.</p>
        <button className="bg-purple-600 text-white px-4 py-2 rounded-full">Start Chatting</button>
      </div>
    </main>
  );
}
