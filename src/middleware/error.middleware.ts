import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', err);

  if (err.message === 'Only PDF files are allowed') {
    res.status(400).json({ error: 'invalid_file_type', message: err.message });
    return;
  }

  if (err.name === 'ValidationError') {
    res.status(400).json({ error: 'validation_error', message: err.message });
    return;
  }

  if (err.code === 11000) {
    res.status(409).json({ error: 'duplicate_entry', message: err.message });
    return;
  }

  if (err.status === 422) {
    res.status(422).json({ error: 'parse_error', message: err.message });
    return;
  }

  res.status(err.status || 500).json({
    error: err.code || 'internal_error',
    message: err.message || 'Internal server error',
  });
}
