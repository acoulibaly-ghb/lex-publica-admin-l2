import { GoogleAICacheManager } from "@google/generative-ai/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { kv } from "@vercel/kv";
import { SYSTEM_INSTRUCTION, DEFAULT_COURSE_CONTENT } from "../constants";

// CONFIGURATION
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

        // 1. GESTION DU CACHE VIA VERCEL KV
        try {
            const cachedInfo: any = await kv.get(cacheKey);
            if (cachedInfo && Date.now() < cachedInfo.expiry - (60 * 1000)) {
                cacheName = cachedInfo.name;
                console.log(`⚡ Cache retrouvé via KV : ${cacheName}`);
            }
        } catch (kvError: any) {
            console.error("⚠️ KV Error (non-bloquant):", kvError.message);
        }

        // 2. (RE)CRÉATION DU CACHE SI NÉCESSAIRE
        if (!cacheName) {
            try {
                console.log("🔄 Génération d'un nouveau Cache Contextuel...");
                const cacheManager = new GoogleAICacheManager(apiKey);
                const newCache = await cacheManager.create({
                    model: "models/gemini-1.5-flash-001",
                    displayName: `cache_${prefix || 'default'}`,
                    ttlSeconds: 3600, // 1 heure
                    contents: [{ role: "user", parts: [{ text: "CONTEXTE DE RÉFÉRENCE :\n" + DEFAULT_COURSE_CONTENT }] }],
                });

                cacheName = newCache.name;
                const expiry = new Date(newCache.expireTime).getTime();

                // Sauvegarde dans KV
                await kv.set(cacheKey, { name: cacheName, expiry });
            } catch (cacheError: any) {
                console.error("❌ Cache Creation Error:", cacheError);
                return res.status(500).json({ error: `Échec de création du cache : ${cacheError.message}` });
            }
        }

        // 3. GÉNÉRATION DE LA RÉPONSE AVEC LE CACHE
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: "models/gemini-1.5-flash-001",
                cachedContent: cacheName,
            });

            const studentContext = currentProfile
                ? `\n\nÉTUDIANT : ${currentProfile.name} (ID: ${currentProfile.id}). SCORES : ${JSON.stringify(currentProfile.scores)}`
                : "";

            const chatHistory = (messages || [])
                .filter((m: any) => !m.isError && m.text && m.text.trim() !== "")
                .slice(-10)
                .map((m: any) => ({
                    role: m.role === 'model' ? 'model' : 'user',
                    parts: [{ text: m.text }]
                }));

            const lastUserMessage = chatHistory.pop();
            if (!lastUserMessage) return res.status(400).json({ error: "Aucun message utilisateur valide." });

            const chat = model.startChat({
                history: chatHistory,
                systemInstruction: SYSTEM_INSTRUCTION + studentContext,
            });

            const result = await chat.sendMessage(lastUserMessage.parts[0].text);
            return res.status(200).json({ text: result.response.text() });
        } catch (aiError: any) {
            console.error("❌ AI Error:", aiError);
            return res.status(500).json({ error: `Erreur IA : ${aiError.message}` });
        }

    } catch (globalError: any) {
        console.error("❌ Global Server Error:", globalError);
        return res.status(500).json({ error: `Erreur critique serveur : ${globalError.message}` });
    }
}
