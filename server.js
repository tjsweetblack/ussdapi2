
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai'); // Changed package and class name
const twilio = require('twilio');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const sessions = {}; // In-memory session storage

// --- Configuration - Load from Environment Variables ---
// For local development, you can use a .env file and the dotenv package.
// In production, set these environment variables in your deployment environment.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

// Initialize Gemini AI Client
let ai;
if (GEMINI_API_KEY) {
    try {
        ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY }); // Changed initialization
        console.log("Gemini AI client initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize GoogleGenAI. Ensure API_KEY is valid.", error); // Updated error message
        ai = null;
    }
} else {
    console.warn("GEMINI_API_KEY environment variable is not set. Gemini features will not work.");
    ai = null;
}

// Initialize Twilio Client
let twilioClient;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
    try {
        twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
        console.log("Twilio client initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize Twilio client:", error);
        twilioClient = null;
    }
} else {
    console.warn("One or more Twilio environment variables (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER) are not set. SMS functionality will be disabled.");
    twilioClient = null;
}


const MAPAZZZ_API_BASE_URL = 'https://mapazzz-api.vercel.app/api';

// --- Helper function to send SMS via Twilio ---
async function sendTwilioSms(to, body) {
    if (!twilioClient) {
        console.error("Twilio client not initialized. Cannot send SMS.");
        return "Serviço SMS indisponível. Verifique as credenciais Twilio.";
    }
    if (!to || !body) {
        return "Número do destinatário ou mensagem em falta.";
    }
    // Basic validation for phone number format (E.164 like)
    if (!/^\+?[1-9]\d{1,14}$/.test(to)) {
        return `Número de destino (${to}) inválido. Use formato internacional (ex: +244XXXXXXXXX).`;
    }

    try {
        const message = await twilioClient.messages.create({
            body: body,
            from: TWILIO_PHONE_NUMBER,
            to: to
        });
        console.log(`SMS sent successfully to ${to}. SID: ${message.sid}`);
        return `SMS enviado para ${to}!`;
    } catch (error) {
        console.error(`Error sending SMS to ${to}:`, error);
        if (error.code === 21211) { // Invalid 'To' Phone Number
             return `Falha ao enviar SMS: Número de destino (${to}) inválido.`;
        }
        if (error.code === 21610 || error.code === 21612 || error.code === 21614) { // Unsubscribed, inactive, or blocked by recipient
            return `Falha ao enviar SMS: O número ${to} não pode receber mensagens deste remetente.`;
        }
        if (error.code === 21408) { // Permission to send an SMS has not been enabled for the region indicated by the 'To' number
            return `Falha ao enviar SMS: Não há permissão para enviar SMS para a região do número ${to}.`;
        }
        return `Falha ao enviar SMS para ${to}. (${error.message || 'Erro desconhecido'})`;
    }
}


// --- Helper function to get Malaria Probability from Gemini ---
async function getMalariaProbabilityJS(symptomsDescription) {
    if (!ai) return "Serviço de IA indisponível. Verifique a configuração da API_KEY.";
    if (!symptomsDescription || symptomsDescription.trim() === "") {
        return "Nenhum sintoma fornecido para análise.";
    }
    // Strongly refined prompt to ensure percentage output
    const prompt = `Analise os sintomas para malária: "${symptomsDescription}". FORNEÇA OBRIGATORIAMENTE uma probabilidade em percentagem (0% a 100%) de ser malária. A resposta DEVE iniciar com a percentagem (ex: "30%"). Após a percentagem, adicione uma explicação MUITO BREVE (máximo 45 caracteres para a explicação, em português). Não mencione outras doenças. Se a certeza for baixa, use uma percentagem baixa. Exemplo 1: "10% (Sintomas vagos.)" Exemplo 2: "85% (Sintomas clássicos.)"`;
    try {
        // Using ai.models.generateContent directly as per @google/genai SDK
        const result = await ai.models.generateContent({
            model: "gemini-1.5-flash-latest", // Specify model directly
            contents: prompt, // Pass prompt string directly
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 60, // Adjusted for concise USSD response
            }
        });
        return result.text || "Não foi possível obter uma análise dos sintomas."; // Access text directly
    }
    catch (error)
    {
        console.error("Error calling Gemini API for malaria probability:", error);
        return "Erro ao analisar sintomas. Tente mais tarde.";
    }
}

// --- Helper function to get Zone Solution from Gemini ---
async function getZoneSolutionJS(problemDescription) {
    if (!ai) return "Serviço de IA indisponível. Verifique a configuração da API_KEY.";
    if (!problemDescription || problemDescription.trim() === "") {
        return "Nenhuma descrição do problema fornecida.";
    }
    const prompt = `Para o seguinte problema de zona em Angola: "${problemDescription}", forneça uma solução prática e muito concisa em português (máximo 150 caracteres). Exemplo: 'Lixo acumulado' -> 'Reporte à administração local para limpeza.'`;
    try {
        // Using ai.models.generateContent directly as per @google/genai SDK
        const result = await ai.models.generateContent({
            model: "gemini-1.5-flash-latest", // Specify model directly
            contents: prompt, // Pass prompt string directly
            generationConfig: {
                temperature: 0.5,
                maxOutputTokens: 80, // Adjusted for concise USSD response
            }
        });
        return result.text || "Não foi possível obter uma sugestão."; // Access text directly
    } catch (error) {
        console.error("Error calling Gemini API for zone solution:", error);
        return "Erro ao obter sugestão. Tente mais tarde.";
    }
}

// --- Helper function to format zones data for USSD ---
function formatZonesForUSSD(zones, riskLevelFilter)
{
    // riskLevelFilter is "Alto", "Médio", "Baixo", or null (for "Todas")
    if (!zones || zones.length === 0) {
        const filterText = riskLevelFilter ? riskLevelFilter.toLowerCase() + ' ' : '';
        return `Nenhuma zona de risco ${filterText}encontrada.`;
    }

    const riskLevelStringToNumeric = { // Maps USSD input string (lowercase) to API numeric value
        "alto": 3,
        "médio": 2,
        "baixo": 1
    };

    const riskLevelNumericToString = { // Maps API numeric value to display string
        3: "Alto",
        2: "Médio",
        1: "Baixo"
    };

    let filteredZones = zones;
    if (riskLevelFilter) {
        const numericEquivalent = riskLevelStringToNumeric[riskLevelFilter.toLowerCase()];
        if (numericEquivalent !== undefined) {
            filteredZones = zones.filter(zone => zone.riskLevel === numericEquivalent);
        } else {
            // Fallback for an unrecognized filter string, though current logic should prevent this.
            console.warn(`Unrecognized riskLevelFilter: ${riskLevelFilter}. Showing no zones for this filter.`);
            filteredZones = [];
        }
    }

    if (filteredZones.length === 0) {
        const filterText = riskLevelFilter ? riskLevelFilter.toLowerCase() + ' ' : '';
        return `Nenhuma zona de risco ${filterText}encontrada.`;
    }

    const messageHeader = riskLevelFilter ? `Zonas de Risco ${riskLevelFilter}:\n` : `Zonas de Risco (Todas):\n`;
    let responseMessage = messageHeader;
    const MAX_ZONES_TO_SHOW = 5; // Display up to 5 zones as requested
    const zonesToShow = filteredZones.slice(0, MAX_ZONES_TO_SHOW);

    zonesToShow.forEach((zone, index) => {
        const displayRisk = riskLevelNumericToString[zone.riskLevel] || zone.riskLevel || 'N/D';
        responseMessage += `${index + 1}. ${zone.location || 'Local Desconhecido'} (${displayRisk})\n`;
    });
    if (filteredZones.length > zonesToShow.length) {
        responseMessage += `Mais ${filteredZones.length - zonesToShow.length} zonas disponíveis.`;
    }
    return responseMessage.trim();
}

function formatReportsForUSSD(reports, municipalityFilter) {
    if (!reports || reports.length === 0) {
        return `Nenhuma reportagem ${municipalityFilter ? 'para ' + municipalityFilter + ' ' : ''}encontrada.`;
    }
    let filteredReports = reports;
    if (municipalityFilter && municipalityFilter.toLowerCase() !== 'outro' && municipalityFilter.toLowerCase() !== 'todos') {
         filteredReports = reports.filter(report => report.municipality && report.municipality.toLowerCase() === municipalityFilter.toLowerCase());
    }
     if (filteredReports.length === 0 && municipalityFilter && municipalityFilter.toLowerCase() !== 'outro' && municipalityFilter.toLowerCase() !== 'todos') {
        return `Nenhuma reportagem para ${municipalityFilter} encontrada.`;
    }


    let message = `Reportagens ${municipalityFilter && municipalityFilter.toLowerCase() !== 'todos' ? municipalityFilter : 'Geral'}:\n`;
    const reportsToShow = filteredReports.slice(0, 1); // Show one detailed report
    reportsToShow.forEach((report) => {
        let desc = report.description || 'Sem descrição.';
        if (desc.length > 70) desc = desc.substring(0, 67) + "...";
        message += `${report.title || 'N/A'}: ${desc} (Risco: ${report.riskLevel || 'N/D'})\n`;
    });
    if (filteredReports.length > reportsToShow.length) {
        message += `Mais ${filteredReports.length - reportsToShow.length} reportagens.`;
    }
    return message.trim();
}


app.get('/', (req, res) => {
    res.send("ok");
});

app.post('/ussd', async (req, res) => {
  const {
    sessionId,
    serviceCode,
    phoneNumber,
    text
  } = req.body;

  console.log("Incoming USSD data: ", req.body);

  let response = '';
  let session = sessions[sessionId];

  if (!session || typeof session !== 'object' || !session.flow) {
    sessions[sessionId] = { flow: 'initial', data: {} };
    session = sessions[sessionId];
  }
  let currentFlow = session.flow;
  let lastInput = text ? (text.includes('*') ? text.split('*').pop() : text) : '';
  if (lastInput === undefined || lastInput === null) lastInput = '';


  console.log(`Session ID: ${sessionId}, Current Flow: ${currentFlow}, Raw Input: "${text}", Extracted Last Input: "${lastInput}"`);

  const mainMenu = `CON Bem-vindo ao USSD Service do mapaZZZ\n1. Zonas de risco\n2. Reportagens\n3. Epaludismo (Malária)\n4. Soluções de Zonas\n5. Dicas de Saúde\n6. Contactos de Emergência`;

  if (lastInput === '' && currentFlow !== 'initial' && currentFlow !== 'menu') {
    sessions[sessionId] = { flow: 'menu', data: {} };
    currentFlow = 'menu';
    response = mainMenu;
  } else if (currentFlow === 'initial' || (currentFlow === 'menu' && lastInput === '')) {
    response = mainMenu;
    sessions[sessionId] = { flow: 'menu', data: {} };
  } else if (currentFlow === 'menu') {
    sessions[sessionId].data = {};
    if (lastInput === '1') {
      response = 'CON Escolha o nível de risco:\n1. Alto\n2. Médio\n3. Baixo\n4. Todas\n5. Menu Principal';
      sessions[sessionId].flow = 'zones_risk_level_selection';
    } else if (lastInput === '2') {
      response = 'CON Município para reportagens:\n1. Belas\n2. Zango\n3. Viana\n4. Outro (Geral)\n5. Todos (Geral)\n6. Menu Principal';
      sessions[sessionId].flow = 'reports_municipality_selection';
    } else if (lastInput === '3') {
      response = 'CON Descreva os seus sintomas (ex: febre, dor de cabeça):';
      sessions[sessionId].flow = 'symptoms_input';
    } else if (lastInput === '4') {
      response = 'CON Descreva o problema na sua zona:';
      sessions[sessionId].flow = 'zone_problem_input';
    } else if (lastInput === '5') {
      response = 'CON Dicas de Saúde:\n1. Prevenção da Malária\n2. Saneamento Básico\n3. Primeiros Socorros (Básico)\n4. Menu Principal';
      sessions[sessionId].flow = 'health_tips_menu';
    } else if (lastInput === '6') {
      response = `END Contactos Úteis:\nPolicia: 113\nBombeiros: 115\nAmbulância (INEMA): 112\nProteção Civil: 117\nViolência Doméstica: 146`;
      delete sessions[sessionId];
    } else {
      response = 'END Seleção inválida.';
      delete sessions[sessionId];
    }
  } else if (currentFlow === 'zones_risk_level_selection') {
    if (lastInput === '5') { // Back to main menu
        response = mainMenu;
        sessions[sessionId] = { flow: 'menu', data: {} };
    } else {
        let selectedRiskLevel = '';
        if (lastInput === '1') selectedRiskLevel = 'Alto';
        else if (lastInput === '2') selectedRiskLevel = 'Médio';
        else if (lastInput === '3') selectedRiskLevel = 'Baixo';
        else if (lastInput === '4') selectedRiskLevel = null; // All
        else {
            response = 'END Seleção inválida para Zonas.';
            delete sessions[sessionId];
        }

        if (response === '') { // Only proceed if not an invalid selection
            // --- SIMULATED ZONES DATA ---
            const sampleZones = [
                { location: "Clínica CSE", risk: "Alto" },
                { location: "ISPTC Talatona", risk: "Médio" },
                { location: "Mercado Kifica", risk: "Baixo" }
            ];

            let ussdZoneMessage = "Zonas (Simulado):\n";
            let smsZoneMessage = "Zonas Risco (MapaZZZ):\n";

            sampleZones.forEach((zone, index) => {
                const item = `${index + 1}. ${zone.location} (${zone.risk})`;
                ussdZoneMessage += item + "\n";
                smsZoneMessage += item + (index === sampleZones.length - 1 ? "" : "\n");
            });
            ussdZoneMessage = ussdZoneMessage.trim();

            // Send SMS
            const smsConfirmation = await sendTwilioSms(phoneNumber, smsZoneMessage);

            response = `END ${ussdZoneMessage}\n${smsConfirmation}`;
            delete sessions[sessionId];
        }
    }
  } else if (currentFlow === 'reports_municipality_selection') {
    if (lastInput === '6') { // Back to main menu
        response = mainMenu;
        sessions[sessionId] = { flow: 'menu', data: {} };
    } else {
        // User input for municipality (1-5) is now effectively ignored for this simulated list
        let selectedMunicipality = '';
        if (lastInput === '1') selectedMunicipality = 'Belas';
        else if (lastInput === '2') selectedMunicipality = 'Zango';
        else if (lastInput === '3') selectedMunicipality = 'Viana';
        else if (lastInput === '4') selectedMunicipality = 'Outro';
        else if (lastInput === '5') selectedMunicipality = 'Todos'; // All
        else {
            response = 'END Seleção inválida para Reportagens.';
            delete sessions[sessionId];
        }

        if (response === '') { // Only proceed if not an invalid selection
            // --- SIMULATED REPORTS DATA ---
            const sampleReports = [
                { title: "Falta de Água", risk: "Alto" },
                { title: "Lixo na Via", risk: "Médio" },
                { title: "Poste Caído", risk: "Alto" }
            ];

            let ussdReportMessage = "Reportagens (Simulado):\n";
            let smsReportMessage = "Reportagens (MapaZZZ):\n";

            sampleReports.forEach((report, index) => {
                const item = `${index + 1}. ${report.title} (${report.risk})`;
                ussdReportMessage += item + "\n";
                smsReportMessage += item + (index === sampleReports.length - 1 ? "" : "\n");
            });
            ussdReportMessage = ussdReportMessage.trim();

            // Send SMS
            const smsConfirmation = await sendTwilioSms(phoneNumber, smsReportMessage);

            response = `END ${ussdReportMessage}\n${smsConfirmation}`;
            delete sessions[sessionId];
        }
    }
  } else if (currentFlow === 'symptoms_input') {
    const symptoms = lastInput;
    console.log(`Received symptoms for session ${sessionId}: ${symptoms}`);
    if (!symptoms || symptoms.trim() === "") {
        response = 'END Por favor, forneça uma descrição dos sintomas. Tente novamente.';
        delete sessions[sessionId]; // Ensure session is deleted
    } else {
        const analysisResult = await getMalariaProbabilityJS(symptoms);

        // Check if analysisResult itself is an error message from getMalariaProbabilityJS
        // These are typically "Serviço de IA indisponível..." or "Erro ao analisar sintomas..."
        if (analysisResult.includes("indisponível") || analysisResult.includes("Erro ao analisar") || analysisResult.includes("Nenhum sintoma fornecido")) {
            response = `END ${analysisResult}`;
        } else {
            // Analysis successful, proceed to send SMS
            const smsBody = `Resultado da sua análise de sintomas (USSD MapaZZZ): ${analysisResult}`;
            const smsSendConfirmation = await sendTwilioSms(phoneNumber, smsBody); // phoneNumber is from req.body
            response = `END Análise: ${analysisResult} ${smsSendConfirmation}`;
        }
        delete sessions[sessionId];
    }
  } else if (currentFlow === 'zone_problem_input') {
    const problemDescription = lastInput;
    console.log(`Received zone problem for session ${sessionId}: ${problemDescription}`);
     if (!problemDescription || problemDescription.trim() === "") {
        response = 'END Por favor, forneça uma descrição do problema. Tente novamente.';
        delete sessions[sessionId];
    } else {
        const solutionResult = await getZoneSolutionJS(problemDescription);

        // Check if solutionResult itself is an error message from getZoneSolutionJS
        if (solutionResult.includes("indisponível") || solutionResult.includes("Erro ao obter") || solutionResult.includes("Nenhuma descrição do problema")) {
            response = `END ${solutionResult}`;
        } else {
            // Solution successful, proceed to send SMS
            const smsBody = `Sugestão para o problema na sua zona (USSD MapaZZZ): ${solutionResult}`;
            const smsSendConfirmation = await sendTwilioSms(phoneNumber, smsBody); // phoneNumber is from req.body
            response = `END Sugestão: ${solutionResult} ${smsSendConfirmation}`;
        }
        delete sessions[sessionId];
    }
  } else if (currentFlow === 'health_tips_menu') {
    let tipText = '';
    // Note: phoneNumber is available from the main handler's req.body destructuring

    if (lastInput === '1') {
      tipText = 'Malária: Use mosquiteiro, elimine água parada, procure médico aos primeiros sintomas.';
    } else if (lastInput === '2') {
      tipText = 'Saneamento: Mantenha quintal limpo, lixo no lugar certo, lave as mãos. Saúde!';
    } else if (lastInput === '3') {
      tipText = '1os Socorros: Queimadura leve? Água fria. Cortes? Limpe e cubra. Grave? Ajuda médica!';
    } else if (lastInput === '4') { // Back to main menu
      response = mainMenu;
      sessions[sessionId] = { flow: 'menu', data: {} };
    } else { // Handles invalid input within health_tips_menu
      response = 'END Seleção inválida.';
      delete sessions[sessionId];
    }

    // If a tip was selected (and not 'Back to main menu' or invalid input)
    if (tipText !== '' && response === '') { // response === '' ensures we don't overwrite mainMenu or invalid selection
        const smsBody = `Dica de Saúde (USSD MapaZZZ): ${tipText}`;
        const smsConfirmation = await sendTwilioSms(phoneNumber, smsBody);
        // The USSD response will show the tip and the SMS confirmation
        // Ensure the combined length is suitable for USSD. If too long, you might shorten the USSD part.
        response = `END ${tipText} ${smsConfirmation}`;
        delete sessions[sessionId];
    }
  } else { // Final catch-all for unexpected flows
    console.warn(`Unexpected session flow: ${currentFlow} for session ID: ${sessionId}. Resetting.`);
    response = mainMenu; // Reset to main menu on unexpected flow
    sessions[sessionId] = { flow: 'menu', data: {} };
  }

  res.set('Content-Type', 'text/plain');
  res.send(response);
});

const PORT = process.env.PORT || 3000; // Port can still be from env or default
app.listen(PORT, () => {
  console.log(`USSD server running on port ${PORT}`);
  if (!GEMINI_API_KEY) {
    console.warn("***************************************************************************");
    console.warn("ADVERTÊNCIA: A variável de ambiente GEMINI_API_KEY não está definida.");
    console.warn("As funcionalidades que dependem da API Gemini (Malária, Soluções) não irão funcionar.");
    console.warn("Defina a GEMINI_API_KEY no seu ambiente.");
    console.warn("***************************************************************************");
  } else if (!ai) {
     console.warn("***************************************************************************");
     console.warn("ADVERTÊNCIA: Falha ao inicializar o cliente Gemini AI.");
     console.warn("Verifique a validade da GEMINI_API_KEY e a conectividade de rede.");
     console.warn("***************************************************************************");
  }

  if (!twilioClient) {
    console.warn("***************************************************************************");
    console.warn("ADVERTÊNCIA: O cliente Twilio não foi inicializado ou faltam credenciais.");
    console.warn("A funcionalidade de envio de SMS estará desativada.");
    console.warn("Verifique se as variáveis de ambiente TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, e TWILIO_PHONE_NUMBER estão definidas corretamente.");
    console.warn("***************************************************************************");
  }
});