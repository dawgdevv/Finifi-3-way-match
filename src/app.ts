import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'js-yaml';
import { readFileSync } from 'fs';

import { connectDB, dbConnected } from './config/db.js';
import documentRoutes from './routes/documents.route.js';
import matchRoutes from './routes/match.route.js';
import { errorHandler } from './middleware/error.middleware.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies
app.use(express.json());

// Swagger docs
const swaggerDoc = YAML.load(readFileSync(path.join(process.cwd(), 'swagger.yaml'), 'utf8'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

// Serve embedded UI
app.use(express.static(path.join(process.cwd(), 'public')));

// DB readiness middleware — API routes need MongoDB
function dbReady(req: Request, res: Response, next: NextFunction) {
  if (!dbConnected && req.path !== '/health') {
    res.status(503).json({
      error: 'database_unavailable',
      message: 'MongoDB is not connected. Check your MONGODB_URI or start MongoDB.',
    });
    return;
  }
  next();
}

app.use('/documents', dbReady, documentRoutes);
app.use('/match', dbReady, matchRoutes);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    dbConnected,
    timestamp: new Date().toISOString(),
  });
});

// Global error handler
app.use(errorHandler);

async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Swagger UI: http://localhost:${PORT}/api-docs`);
    console.log(`Upload UI: http://localhost:${PORT}/`);
    console.log(`Health: http://localhost:${PORT}/health`);
  });
}

start();
