require('dotenv').config();
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const path = require('path');
const express = require('express');

// Inicializa Firebase Admin
const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Configura el transporte de correo
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Función para buscar reportes vencidos y enviar correos
async function revisarYEnviarCorreos() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  // Trae solo los reportes con estado "Cerrado parcialmente"
  const snapshot = await db.collection('reportes')
    .where('estado', '==', 'Cerrado parcialmente')
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const fechaLimiteStr = data.fechaLimite;
    if (!fechaLimiteStr) continue;

    // Asume formato dd/MM/yyyy
    const [dia, mes, anio] = fechaLimiteStr.split('/');
    const fechaLimite = new Date(`${anio}-${mes}-${dia}T00:00:00`);

    // Si la fecha límite ya pasó y no está marcado como notificado
    if (hoy > fechaLimite && !data.notificadoVencido) {
      await enviarCorreoVencido(
        data.responsable,
        data.descripcion,
        fechaLimiteStr,
        doc.id,
        data
      );
      await db.collection('reportes').doc(doc.id).update({ notificadoVencido: true });
      console.log(`Correo enviado para reporte ${doc.id}`);
    }
  }
}

// Función para enviar el correo
async function enviarCorreoVencido(responsableEmail, descripcion, fechaLimite, reporteId, data) {
  const adminEmail = process.env.ADMIN_EMAIL;
  const asunto = `Reporte vencido de "${data.tipo || 'Sin tipo'}"`;

  // Función auxiliar para generar el cuerpo del correo según destinatario
  function generarCuerpoCorreo(destinatario) {
    const saludo = destinatario === 'admin' ? 'Estimado/a administrador,' : 'Estimado/a responsable,';
    return `
      <p>${saludo}</p>
      <p>El reporte con los siguientes datos ha vencido:</p>
      <ul>
        <li><b>Nombre del reportante:</b> ${data.reportante || 'No especificado'}</li>
        <li><b>Descripción:</b> ${descripcion || 'No especificada'}</li>
        <li><b>Fecha de asignación:</b> ${data.fechaAsignacion || 'No especificada'}</li>
        <li><b>Fecha límite:</b> ${fechaLimite || 'No especificada'}</li>
        <li><b>Lugar:</b> ${data.lugar || 'No especificado'}</li>
        <li><b>Nivel de riesgo:</b> ${data.nivelRiesgo || 'No especificado'}</li>
      </ul>
      <p>Por favor, revise la aplicación de reportes ESIN.</p>
    `;
  }

  // Enviar al administrador
  await transporter.sendMail({
    from: `"Sistema Reportes ESIN" <${process.env.EMAIL_USER}>`,
    to: adminEmail,
    subject: asunto,
    html: generarCuerpoCorreo('admin')
  });

  // Enviar al responsable
  await transporter.sendMail({
    from: `"Sistema Reportes ESIN" <${process.env.EMAIL_USER}>`,
    to: responsableEmail,
    subject: asunto,
    html: generarCuerpoCorreo('responsable')
  });
}

// Programa la tarea cada día
cron.schedule('29 13 * * *', () => {
  console.log('Ejecutando revisión de reportes vencidos...');
  revisarYEnviarCorreos().catch(console.error);
});

// También puedes ejecutarlo manualmente al iniciar
revisarYEnviarCorreos().catch(console.error);

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Reportes Mailer está corriendo.');
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});