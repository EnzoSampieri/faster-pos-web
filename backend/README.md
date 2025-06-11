# FASTER POS Backend

Este es un backend sencillo en Node.js para gestionar mesas abiertas y pedidos en FASTER POS.

## Requisitos
- Node.js >= 14

## Instalación

1. Abre una terminal en esta carpeta (`backend`).
2. Instala las dependencias:
   ```sh
   npm install
   ```

## Uso

Para iniciar el servidor:

```sh
npm start
```

El backend quedará escuchando en: [http://localhost:3000](http://localhost:3000)

## Endpoints
- `GET /mesas` — Devuelve todas las mesas abiertas (JSON)
- `POST /mesas` — Guarda o actualiza una mesa abierta (enviar JSON)
- `DELETE /mesas/:mesa` — Elimina una mesa por número

Los datos se guardan en el archivo `mesas_abiertas.json` en esta misma carpeta. 