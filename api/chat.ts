// Imports dynamiques à l'intérieur du handler pour alléger le démarrage

// CONFIGURATION KV
const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_API_TOKEN;
const prefix = process.env.COURSE_ID ? `${process.env.COURSE_ID}_` : '';
const cacheKey = `${prefix}active_cache_info`;
const apiKey = (process.env.API_KEY || process.env.VITE_API_KEY || process.env.GOOGLE_API_KEY || "").trim();

export const config = {
    maxDuration: 60,
};

export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!apiKey) return res.status(500).json({ error: 'Clé API manquante ou invalide dans Vercel' });

    // Timeout guard pour éviter le crash brutal de Vercel
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timeout préventif (9s) : Le serveur a mis trop de temps à s'initialiser.")), 9000);
    });

    try {
        const result = await Promise.race([
            processRequest(req),
            timeoutPromise
        ]);
        return res.status(200).json(result);
    } catch (error: any) {
        console.error("❌ Erreur Chat:", error.message);
        const isTimeout = error.message.includes("Timeout");
        return res.status(isTimeout ? 200 : 500).json({
            error: error.message,
            status: isTimeout ? "WARMING_UP" : "ERROR"
        });
    }
}

async function processRequest(req: any) {
    const { messages, currentProfile } = req.body;

    // Import des constantes
    const { SYSTEM_INSTRUCTION, DEFAULT_COURSE_CONTENT } = await import("../constants.js");
    let cacheName = null;
    let useFallback = false;

    // 1. KV CHECK (Vérification si un cache existe déjà en base de données)
    if (kvUrl && kvToken) {
        try {
            const kvRes = await fetch(`${kvUrl}/get/${cacheKey}`, { headers: { Authorization: `Bearer ${kvToken}` } });
            const kvData = await kvRes.json();
            const cachedInfo = kvData.result ? (typeof kvData.result === 'string' ? JSON.parse(kvData.result) : kvData.result) : null;
            if (cachedInfo && Date.now() < cachedInfo.expiry - (60 * 1000)) {
                cacheName = cachedInfo.name;
            }
        } catch (e) { console.error("KV Error:", e); }
    }

    // -----------------------------------------------------------
    // LA CORRECTION EST ICI : Utilisation de votre modèle disponible
    // -----------------------------------------------------------
    const activeModel = "models/gemini-2.5-flash"; 

    // 2. CACHE CREATION (Si pas de cache trouvé en base)
    if (!cacheName) {
        try {
            const { GoogleAICacheManager } = await import("@google/generative-ai/server");
            const cacheManager = new GoogleAICacheManager(apiKey);
            const combined = `INSTRUCTIONS : ${SYSTEM_INSTRUCTION}\n\nCOURS : ${DEFAULT_COURSE_CONTENT}`;

            // Tentative de création du cache
            const newCache = await cacheManager.create({
                model: "models/gemini-1.5-flash-001", // On garde le 1.5-001 pour la structure du cache (plus stable)
                displayName: `cache_${prefix || 'default'}`,
                ttlSeconds: 3600,
                contents: [{ role: "user", parts: [{ text: combined }] }],
            });

            cacheName = newCache.name;
            const expiry = new Date(newCache.expireTime).getTime();

            // Sauvegarde dans KV
            if (kvUrl && kvToken) {
                await fetch(`${kvUrl}/set/${cacheKey}`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${kvToken}` },
                    body: JSON.stringify({ name: cacheName, expiry })
                });
            }
        } catch (cacheError: any) {
            console.warn("⚠️ Caching non supporté ou erreur, passage en mode standard:", cacheError.message);
            // Si le cache échoue, on forcera l'utilisation sans cache
            useFallback = true;
        }
    }

    // 3. AI RESPONSE
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);

    let model;
    let chat;
    const studentInfo = currentProfile
        ? `[ÉTUDIANT : ${currentProfile.name} (ID: ${currentProfile.id})]\n`
        : "";

    const history = (messages || [])
        .filter((m: any) => !m.isError && m.text && m.text.trim() !== "")
        .slice(-6)
        .map((m: any) => ({
            role: m.role === 'model' ? 'model' : 'user',
            parts: [{ text: m.text }]
        }));

    // SÉCURITÉ : Gemini exige que l'historique commence par 'user'
    while (history.length > 0 && history[0].role === 'model') {
        history.shift();
    }

    const lastMsg = history.pop();
    if (!lastMsg) throw new Error("Aucun message utilisateur.");

    // Initialisation du modèle
    if (cacheName && !useFallback) {
        // Mode Optimisé (Cache) - Doit utiliser un modèle compatible cache (1.5)
        // Note: Si vous avez créé le cache sur 1.5, il faut l'interroger avec 1.5
        model = genAI.getGenerativeModelFromCachedContent(cacheName);
        chat = model.startChat({ history });
    } else {
        // Mode Standard (Fallback) - Ici on utilise votre modèle PUISSANT (2.5)
        const fullContext = `INSTRUCTIONS : ${SYSTEM_INSTRUCTION}\n\nCOURS : ${DEFAULT_COURSE_CONTENT}\n\n`;
        model = genAI.getGenerativeModel({
            model: activeModel, // Utilise gemini-2.5-flash
            systemInstruction: fullContext
        });

        chat = model.startChat({
            history: history
        });
    }

    const input = (history.length === 0 || useFallback) ? studentInfo + lastMsg.parts[0].text : lastMsg.parts[0].text;
    const aiRes = await chat.sendMessage(input);

    return { text: aiRes.response.text(), cached: !!cacheName && !useFallback };
}
