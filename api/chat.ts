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
    let { messages, currentProfile } = req.body;
    let cacheName = null;
    let useFallback = false;

    // 1. KV CHECK (Vérification si un cache existe déjà en base de données)
    if (kvUrl && kvToken) {
        try {
            // Utilisation du format array pour plus de robustesse avec Upstash/Vercel KV
            const kvRes = await fetch(kvUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${kvToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(['GET', cacheKey])
            });
            const kvData = await kvRes.json();
            const result = kvData.result;
            const cachedInfo = result ? (typeof result === 'string' ? JSON.parse(result) : result) : null;

            if (cachedInfo && Date.now() < cachedInfo.expiry - (60 * 1000)) {
                cacheName = cachedInfo.name;
            }
        } catch (e) {
            console.error("❌ KV Check Error:", e);
        }
    }

    // -----------------------------------------------------------
    // LA CORRECTION EST ICI : Utilisation de votre modèle disponible
    // -----------------------------------------------------------
    const activeModel = "models/gemini-2.5-flash";

    // 2. CACHE CREATION (Si pas de cache trouvé en base)
    if (!cacheName) {
        try {
            // Import tardif des constantes (seulement si besoin de créer un cache)
            const { SYSTEM_INSTRUCTION, DEFAULT_COURSE_CONTENT } = await import("../constants.js");
            const { GoogleAICacheManager } = await import("@google/generative-ai/server");
            const cacheManager = new GoogleAICacheManager(apiKey);
            const combined = `INSTRUCTIONS : ${SYSTEM_INSTRUCTION}\n\nCOURS : ${DEFAULT_COURSE_CONTENT}`;

            // Tentative de création du cache
            const newCache = await cacheManager.create({
                model: "models/gemini-1.5-flash-001",
                displayName: `cache_${prefix || 'default'}`,
                ttlSeconds: 3600,
                contents: [{ role: "user", parts: [{ text: combined }] }],
            });

            cacheName = newCache.name;
            const expiry = new Date(newCache.expireTime).getTime();

            // Sauvegarde dans KV avec expiration Redis automatique par sécurité (TTL)
            if (kvUrl && kvToken) {
                await fetch(kvUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${kvToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(['SET', cacheKey, JSON.stringify({ name: cacheName, expiry }), 'EX', 3600])
                }).catch(e => console.error("❌ KV Set Error:", e));
            }
        } catch (cacheError: any) {
            console.warn("⚠️ Caching non supporté ou erreur, passage en mode standard:", cacheError.message);
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
        .slice(-20) // Augmentation de la mémoire à 10 échanges pour plus de stabilité dans les exercices
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
        // Mode Optimisé (Cache)
        model = genAI.getGenerativeModelFromCachedContent(cacheName);
        chat = model.startChat({ history });
    } else {
        // Mode Standard (Fallback) - Import différé des constantes seulement si nécessaire
        const { SYSTEM_INSTRUCTION, DEFAULT_COURSE_CONTENT } = await import("../constants.js");
        const fullContext = `INSTRUCTIONS : ${SYSTEM_INSTRUCTION}\n\nCOURS : ${DEFAULT_COURSE_CONTENT}\n\n`;
        model = genAI.getGenerativeModel({
            model: activeModel,
            systemInstruction: fullContext
        });

        chat = model.startChat({
            history: history
        });
    }

    // On n'injecte l'identité que lors du TOUT PREMIER message pour éviter que l'IA ne se répète
    const input = (history.length === 0) ? studentInfo + lastMsg.parts[0].text : lastMsg.parts[0].text;
    const aiRes = await chat.sendMessage(input);

    return { text: aiRes.response.text(), cached: !!cacheName && !useFallback };
}
