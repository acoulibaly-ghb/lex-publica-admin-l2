import { GoogleAICacheManager } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { SYSTEM_INSTRUCTION, DEFAULT_COURSE_CONTENT } from "../constants";

// Configuration pour Vercel (KV)
const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.STORAGE_REST_API_URL;
const kvToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.STORAGE_REST_API_TOKEN;
const prefix = process.env.COURSE_ID ? `${process.env.COURSE_ID}_` : '';
const cacheKey = `${prefix}active_cache_info`;

const apiKey = (process.env.API_KEY || process.env.VITE_API_KEY || process.env.GOOGLE_API_KEY || "").trim();

// Export pour augmenter le timeout sur Vercel (limité à 10s sur Hobby, mais aide sur Pro)
export const config = {
    maxDuration: 60,
};

export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!apiKey) return res.status(500).json({ error: 'Clé API manquante ou invalide' });

    try {
        const { messages, currentProfile } = req.body;
        const cacheManager = new GoogleAICacheManager(apiKey);
        let cacheName = null;

        // 1. GESTION DU CACHE VIA VERCEL KV (Persistance entre les requêtes de tous les étudiants)
        if (kvUrl && kvToken) {
            try {
                const kvRes = await fetch(`${kvUrl}/get/${cacheKey}`, { headers: { Authorization: `Bearer ${kvToken}` } });
                const kvData = await kvRes.json();
                const cachedInfo = kvData.result ? JSON.parse(kvData.result) : null;

                if (cachedInfo && Date.now() < cachedInfo.expiry - (60 * 1000)) {
                    cacheName = cachedInfo.name;
                    console.log(`⚡ Cache retrouvé via KV : ${cacheName}`);
                }
            } catch (e) { console.error("Erreur lecture KV Cache:", e); }
        }

        // 2. CRÉATION DU CACHE SI NÉCESSAIRE
        // Note : Le cache nécessite au moins 32k tokens. Votre cours actuel fait ~90k tokens, donc c'est parfait.
        if (!cacheName) {
            console.log("🔄 Génération d'un nouveau Cache Contextuel...");
            const newCache = await cacheManager.create({
                model: "models/gemini-1.5-flash-001",
                displayName: `cache_${prefix || 'default'}`,
                ttlSeconds: 3600, // 1 heure
                contents: [{ role: "user", parts: [{ text: "CONTEXTE DE RÉFÉRENCE :\n" + DEFAULT_COURSE_CONTENT }] }],
            });

            cacheName = newCache.name;
            const expiry = new Date(newCache.expireTime).getTime();

            // Sauvegarde dans KV pour les prochaines requêtes
            if (kvUrl && kvToken) {
                await fetch(`${kvUrl}/set/${cacheKey}`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${kvToken}` },
                    body: JSON.stringify({ name: cacheName, expiry })
                });
            }
        }

        // 3. GÉNÉRATION DE LA RÉPONSE AVEC LE CACHE
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "models/gemini-1.5-flash-001",
            cachedContent: cacheName,
        });

        const studentContext = currentProfile
            ? `\n\nÉTUDIANT : ${currentProfile.name} (ID: ${currentProfile.id}). SCORES : ${JSON.stringify(currentProfile.scores)}`
            : "";

        const chatHistory = messages
            .filter((m: any) => !m.isError && m.text && m.text.trim() !== "")
            .slice(-10)
            .map((m: any) => ({
                role: m.role === 'model' ? 'model' : 'user',
                parts: [{ text: m.text }]
            }));

        const lastUserMessage = chatHistory.pop();
        if (!lastUserMessage) return res.status(400).json({ error: "Aucun message." });

        const chat = model.startChat({
            history: chatHistory,
            systemInstruction: SYSTEM_INSTRUCTION + studentContext,
        });

        const result = await chat.sendMessage(lastUserMessage.parts[0].text);
        return res.status(200).json({ text: result.response.text() });

    } catch (error: any) {
        console.error("❌ Erreur Backend Chat:", error);
        return res.status(500).json({
            error: error.message || "Erreur interne",
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
