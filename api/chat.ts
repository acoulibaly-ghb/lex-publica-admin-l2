import { GoogleAICacheManager } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_INSTRUCTION, DEFAULT_COURSE_CONTENT } from "../constants";

// CONFIGURATION KV (Via fetch pour éviter les problèmes de bundle)
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

    try {
        const { messages, currentProfile } = req.body;
        let cacheName = null;

        // 1. GESTION DU CACHE VIA KV (FETCH)
        if (kvUrl && kvToken) {
            try {
                const kvRes = await fetch(`${kvUrl}/get/${cacheKey}`, { headers: { Authorization: `Bearer ${kvToken}` } });
                const kvData = await kvRes.json();
                const cachedInfo = kvData.result ? (typeof kvData.result === 'string' ? JSON.parse(kvData.result) : kvData.result) : null;

                if (cachedInfo && Date.now() < cachedInfo.expiry - (60 * 1000)) {
                    cacheName = cachedInfo.name;
                    console.log(`⚡ Cache retrouvé via KV : ${cacheName}`);
                }
            } catch (e) { console.error("⚠️ KV Error:", e); }
        }

        // 2. (RE)CRÉATION DU CACHE SI NÉCESSAIRE
        if (!cacheName) {
            try {
                console.log("🔄 Génération d'un nouveau Cache Contextuel...");
                const cacheManager = new GoogleAICacheManager(apiKey);

                // Note : On inclut les instructions système dans le cache car certains modèles n'acceptent pas 
                // de systemInstruction séparé quand on utilise un cache.
                const combinedContext = `INSTRUCTIONS SYSTÈME :\n${SYSTEM_INSTRUCTION}\n\nCOURS DE RÉFÉRENCE :\n${DEFAULT_COURSE_CONTENT}`;

                const newCache = await cacheManager.create({
                    model: "models/gemini-1.5-flash-001",
                    displayName: `cache_${prefix || 'default'}`,
                    ttlSeconds: 3600, // 1 heure
                    contents: [{ role: "user", parts: [{ text: combinedContext }] }],
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
                console.error("❌ Cache Creation Error:", cacheError);
                return res.status(500).json({ error: `Échec création cache: ${cacheError.message}` });
            }
        }

        // 3. GÉNÉRATION DE LA RÉPONSE
        try {
            const genAI = new GoogleGenerativeAI(apiKey);

            // SYNTAXE CORRECTE : getGenerativeModelFromCachedContent
            const model = genAI.getGenerativeModelFromCachedContent(cacheName);

            // Contexte étudiant injecté dans le premier message utilisateur pour la session
            const studentContext = currentProfile
                ? `[CONTEXTE ÉTUDIANT : ${currentProfile.name} (ID: ${currentProfile.id}). SCORES : ${JSON.stringify(currentProfile.scores)}]\n\n`
                : "";

            const history = (messages || [])
                .filter((m: any) => !m.isError && m.text && m.text.trim() !== "")
                .slice(-6) // On limite l'historique pour rester léger
                .map((m: any) => ({
                    role: m.role === 'model' ? 'model' : 'user',
                    parts: [{ text: m.text }]
                }));

            const lastMsg = history.pop();
            if (!lastMsg) return res.status(400).json({ error: "Aucun message utilisateur." });

            // Si c'est le début de la conversation, on ajoute le contexte étudiant
            const finalUserInput = history.length === 0 ? studentContext + lastMsg.parts[0].text : lastMsg.parts[0].text;

            const chat = model.startChat({
                history: history,
            });

            const result = await chat.sendMessage(finalUserInput);
            return res.status(200).json({ text: result.response.text() });
        } catch (aiError: any) {
            console.error("❌ AI Error:", aiError);
            return res.status(500).json({ error: `Erreur IA : ${aiError.message}` });
        }

    } catch (globalError: any) {
        console.error("❌ Global Error:", globalError);
        return res.status(500).json({ error: `Erreur interne : ${globalError.message}` });
    }
}
