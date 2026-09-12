# Workflow de features

1. Actualizar la rama base (`frontend` o `backend`) y crear una rama puntual si hace falta.
2. Definir o ajustar el shape del mock en `lib/mock-data.ts` cuando corresponda.
3. Crear la presentación en `components/`, usando el HTML de referencia visual.
4. Crear el hook de dominio en `features/`.
5. Crear la server action en `actions/` devolviendo el mismo shape del mock.
6. Conectar la vista mediante el hook.
7. Ejecutar `pnpm lint` y `pnpm build`.
8. Abrir el pull request contra la rama base del área.
9. Más adelante, reemplazar el mock por Prisma sin cambiar la forma consumida
   por hooks y componentes.

No definir modelos Prisma ni tipos del protocolo antes de cerrarlos. No llamar
`fetch` desde `components/`.
