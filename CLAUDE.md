# DeepClaude Development Guide

## Commands
- Backend build: `cargo build --release`
- Backend run: `cargo run`
- Frontend dev: `cd frontend && npm run dev`
- Frontend build: `cd frontend && npm run build`
- Frontend lint: `cd frontend && npm run lint`
- Frontend start: `cd frontend && npm run start`

## Code Style

### Rust (Backend)
- Use snake_case for variables/functions, PascalCase for types/structs
- Order imports: module declarations, crate-local, external crates, std
- Use Result<T, E> with descriptive error mapping
- Document with `///` (functions) and `//!` (modules)
- 4-space indentation

### TypeScript/React (Frontend)
- Use camelCase for variables/functions, PascalCase for components/interfaces
- Order imports: React/Next.js, third-party, local components
- Use functional components with explicit prop interfaces
- Style with Tailwind utility classes and component composition
- 2-space indentation
- Use consistent type definitions and type safety