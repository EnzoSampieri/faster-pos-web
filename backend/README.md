# FASTER POS Backend

Este es un backend sencillo en Node.js para gestionar mesas abiertas y pedidos en FASTER POS.

## Requisitos
- Node.js >= 14

## Dependencias principales

- **puppeteer**: Se utiliza para generar archivos PDF a partir del HTML de la cuenta, permitiendo que el cliente descargue la cuenta en formato universal y visualmente atractivo.

### Instalación de Puppeteer

```sh
npm install puppeteer
```

> **Nota:** Puppeteer descarga una versión de Chromium (~100-200MB). Se recomienda tener al menos 512MB de RAM libre en el servidor para evitar problemas en la generación de PDFs.

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

## Uso de generación de PDF

- El endpoint `/cuenta-pdf/:mesaId` genera y sirve el PDF de la cuenta de la mesa indicada.
- El QR puede apuntar directamente a este endpoint para que el cliente descargue el PDF. 