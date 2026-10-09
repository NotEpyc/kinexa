export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Kinexa</h1>
        <p className="text-lg text-gray-600 mb-8">
          Explainable Exercise Form Assessment Platform
        </p>
        <div className="space-y-4 text-left bg-white p-6 rounded-lg shadow-sm border">
          <h2 className="text-xl font-semibold mb-4">API Endpoints</h2>
          <ul className="space-y-2 text-sm text-gray-700">
            <li><code className="bg-gray-100 px-2 py-1 rounded">POST /api/analyze</code> - Upload video for analysis</li>
            <li><code className="bg-gray-100 px-2 py-1 rounded">GET /api/analyses/:id</code> - Fetch analysis</li>
            <li><code className="bg-gray-100 px-2 py-1 rounded">GET /api/patients/:id/analyses</code> - Patient history</li>
            <li><code className="bg-gray-100 px-2 py-1 rounded">CRUD /api/patients</code> - Manage patients</li>
            <li><code className="bg-gray-100 px-2 py-1 rounded">CRUD /api/patients/:id/plans</code> - Exercise plans</li>
            <li><code className="bg-gray-100 px-2 py-1 rounded">CRUD /api/patients/:id/plans/:id/parameters</code> - ROM parameters</li>
            <li><code className="bg-gray-100 px-2 py-1 rounded">GET /api/health</code> - Service status</li>
          </ul>
        </div>
        <div className="mt-6 text-sm text-gray-500">
          Backend: <code>http://localhost:8000</code> | Docs: <code>http://localhost:8000/docs</code>
        </div>
      </div>
    </main>
  );
}