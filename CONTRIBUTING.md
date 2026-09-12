# Contribuir a Hermes

## Ramas

`frontend` y `backend` son ramas base de integración que cuelgan de `main`.
Las ramas puntuales se crean desde la rama base del área y vuelven a ella por
pull request. Nunca se commitea directamente a `main`.

Antes de abrir un pull request, ejecutar `pnpm lint` y `pnpm build`.

## Hooks y CI

- `pre-commit`: ejecuta `lint-staged` con ESLint y Prettier sobre archivos staged.
- `pre-push`: ejecuta `pnpm build`.
- GitHub Actions: ejecuta instalación reproducible, lint y build en cada PR.

## Dónde va cada cosa

- `components/<dominio>/`: presentación; no llama `fetch` ni server actions.
- `features/<dominio>/`: hooks y lógica de dominio para consumir actions.
- `actions/<dominio>.ts`: server actions agrupadas por dominio.
- `lib/`: utilidades, mocks y conexiones compartidas.
- `types/`: tipos compartidos cuando el protocolo esté definido.

Mantener Server Components por defecto y no usar `chat` en nombres nuevos.
