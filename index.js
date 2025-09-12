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

  // Trae todos los reportes
  const snapshot = await db.collection('reportes').get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const fechaLimiteStr = data.fechaLimite;
    if (!fechaLimiteStr) continue;

    // Asume formato dd/MM/yyyy
    const [dia, mes, anio] = fechaLimiteStr.split('/');
    const fechaLimite = new Date(`${anio}-${mes}-${dia}T00:00:00`);

    // Si el estado es "Asignado" y notificadoVencido no es false, lo ponemos en false
    if (data.estado === 'Asignado' && data.notificadoVencido !== false) {
      await db.collection('reportes').doc(doc.id).update({ notificadoVencido: false });
      console.log(`false para reporte ${doc.id} (estado Asignado)`);
      continue; // No notificar si está asignado
    }

    // Si el estado es "Cerrado parcialmente" y la fecha límite ya pasó y no está notificado
    if (data.estado === 'Cerrado parcialmente' && hoy > fechaLimite && !data.notificadoVencido) {
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
  const invisibleChar = '\u200B'; // carácter de espacio de ancho cero

  // Inserta el invisibleChar entre cada letra del ID
  const idInvisible = reporteId.split('').join(invisibleChar);

  // Agrega un timestamp invisible para asegurar unicidad
  const timestamp = Date.now().toString();
  const timestampInvisible = timestamp.split('').join(invisibleChar);

  // Asunto con ID y timestamp ocultos
  const asunto = `Reporte vencido de "${data.tipo || 'Sin tipo'}"${invisibleChar}${idInvisible}${invisibleChar}${timestampInvisible}`;

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

// Programa la tarea a las 8:00 AM todos los días
cron.schedule('48 21 * * *', () => {
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