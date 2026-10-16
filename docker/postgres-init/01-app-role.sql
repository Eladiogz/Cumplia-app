-- Solo desarrollo: se ejecuta al crear el volumen de Postgres por primera vez.
-- `cumplia` (POSTGRES_USER) es el dueño y corre las migraciones.
-- `cumplia_api` es con quien se conecta la API: miembro de cumplia_app, sin
-- privilegios de dueño, así que Row-Level Security se le aplica.
CREATE ROLE cumplia_app NOLOGIN;
CREATE ROLE cumplia_api LOGIN PASSWORD 'cumplia_api' IN ROLE cumplia_app;
