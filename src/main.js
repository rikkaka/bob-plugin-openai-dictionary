//@ts-check

var lang = require("./lang.js");

var SYSTEM_PROMPT = "As an English-Chinese Dictionary, this GPT is tailored to provide bilingual translations between English and Chinese. It is adept at presenting the American English pronunciation, part of speech, and the Chinese translation of English words. For example, for the word 'resist':\
[rīˈzɪst]\
v. 抗拒，抗拔; 忽耐; 反对，抗制\
n. 防染剂; 防腐剂\
This GPT delivers pronunciations in phonetic notation, with parts of speech abbreviated ('v.' for verbs, 'n.' for nouns) and meanings clearly separated by semicolons. It aims for efficiency and precision, providing quick and accurate translations suitable for language learners and anyone needing bilingual word references. It utilizes internet searches to ensure accuracy and comprehensiveness in its translations."

var HttpErrorCodes = {
    "400": "Bad Request",
    "401": "Unauthorized",
    "402": "Payment Required",
    "403": "Forbidden",
    "404": "Not Found",
    "405": "Method Not Allowed",
    "406": "Not Acceptable",
    "407": "Proxy Authentication Required",
    "408": "Request Timeout",
    "409": "Conflict",
    "410": "Gone",
    "411": "Length Required",
    "412": "Precondition Failed",
    "413": "Payload Too Large",
    "414": "URI Too Long",
    "415": "Unsupported Media Type",
    "416": "Range Not Satisfiable",
    "417": "Expectation Failed",
    "418": "I'm a teapot",
    "421": "Misdirected Request",
    "422": "Unprocessable Entity",
    "423": "Locked",
    "424": "Failed Dependency",
    "425": "Too Early",
    "426": "Upgrade Required",
    "428": "Precondition Required",
    "429": "请求过于频繁，请慢一点。OpenAI 对您在 API 上的请求实施速率限制。这些限制适用于每分钟 tokens 数、每分钟请求数（某些情况下是每天请求数）。访问 https://platform.openai.com/account/rate-limits 了解更多信息，或参考 OpenAI 模型的默认速率限制",
    "431": "Request Header Fields Too Large",
    "451": "Unavailable For Legal Reasons",
    "500": "Internal Server Error",
    "501": "Not Implemented",
    "502": "Bad Gateway",
    "503": "Service Unavailable",
    "504": "Gateway Timeout",
    "505": "HTTP Version Not Supported",
    "506": "Variant Also Negotiates",
    "507": "Insufficient Storage",
    "508": "Loop Detected",
    "510": "Not Extended",
    "511": "Network Authentication Required"
}

/**
 * @param {string}  url
 * @returns {string} 
*/
function ensureHttpsAndNoTrailingSlash(url) {
    const hasProtocol = /^[a-z]+:\/\//i.test(url);
    const modifiedUrl = hasProtocol ? url : 'https://' + url;

    return modifiedUrl.endsWith('/') ? modifiedUrl.slice(0, -1) : modifiedUrl;
}

/**
 * @param {boolean} isAzureServiceProvider - Indicates if the service provider is Azure.
 * @param {string} apiKey - The authentication API key.
 * @returns {{
*   "Content-Type": string;
*   "api-key"?: string;
*   "Authorization"?: string;
* }} The header object.
*/
function buildHeader(isAzureServiceProvider, apiKey) {
    return {
        "Content-Type": "application/json",
        [isAzureServiceProvider ? "api-key" : "Authorization"]: isAzureServiceProvider ? apiKey : `Bearer ${apiKey}`
    };
}

/**
 * @param {Bob.TranslateQuery} query
 * @returns {{ 
 *  generatedSystemPrompt: string, 
 *  generatedUserPrompt: string 
 * }}
*/
function generatePrompts(query) {
    let generatedSystemPrompt = SYSTEM_PROMPT;
    let generatedUserPrompt = `${query.text}`

    return { generatedSystemPrompt, generatedUserPrompt };
}

/**
 * @param {string} prompt
 * @param {Bob.TranslateQuery} query
 * @returns {string}
*/
function replacePromptKeywords(prompt, query) {
    if (!prompt) return prompt;
    return prompt.replace("$text", query.text)
        .replace("$sourceLang", query.detectFrom)
        .replace("$targetLang", query.detectTo);
}

/**
 * @param {string} model
 * @param {Bob.TranslateQuery} query
 * @returns {{ 
 *  model: string;
 *  temperature: number;
 *  max_tokens: number;
 *  top_p: number;
 *  frequency_penalty: number;
 *  presence_penalty: number;
 *  messages?: {
 *    role: "system" | "user";
 *    content: string;
 *  }[];
 *  prompt?: string;
 * }}
*/
function buildRequestBody(model, query) {
    let { customSystemPrompt, customUserPrompt } = $option;
    const { generatedSystemPrompt, generatedUserPrompt } = generatePrompts(query);

    customSystemPrompt = replacePromptKeywords(customSystemPrompt, query);
    customUserPrompt = replacePromptKeywords(customUserPrompt, query);

    const systemPrompt = customSystemPrompt || generatedSystemPrompt;
    const userPrompt = customUserPrompt || generatedUserPrompt;

    const standardBody = {
        model: model,
        stream: true,
        temperature: 0.2,
        max_tokens: 1000,
        top_p: 1,
        frequency_penalty: 1,
        presence_penalty: 1,
    };

    return {
        ...standardBody,
        model: model,
        messages: [
            {
                role: "system",
                content: systemPrompt,
            },
            {
                role: "user",
                content: userPrompt,
            },
        ],
    };
}

/**
 * @param {Bob.TranslateQuery} query
 * @param {Bob.HttpResponse} result
 * @returns {void}
*/
function handleError(query, result) {
    const { statusCode } = result.response;
    const reason = (statusCode >= 400 && statusCode < 500) ? "param" : "api";
    query.onCompletion({
        error: {
            type: reason,
            message: `接口响应错误 - ${HttpErrorCodes[statusCode]}`,
            addtion: `${JSON.stringify(result)}`,
        },
    });
}

/**
 * @param {Bob.TranslateQuery} query
 * @param {string} targetText
 * @param {string} textFromResponse
 * @returns {string}
*/
function handleResponse(query, targetText, textFromResponse) {
    if (textFromResponse !== '[DONE]') {
        try {
            const dataObj = JSON.parse(textFromResponse);
            const { choices } = dataObj;
            if (!choices || choices.length === 0) {
                query.onCompletion({
                    error: {
                        type: "api",
                        message: "接口未返回结果",
                        addtion: textFromResponse,
                    },
                });
                return targetText;
            }

            const content = choices[0].delta.content;
            if (content !== undefined) {
                targetText += content;
                query.onStream({
                    result: {
                        from: query.detectFrom,
                        to: query.detectTo,
                        toParagraphs: [targetText],
                    },
                });
            }
        } catch (err) {
            query.onCompletion({
                error: {
                    type: err._type || "param",
                    message: err._message || "Failed to parse JSON",
                    addtion: err._addition,
                },
            });
        }
    }
    return targetText;
}

/**
 * @type {Bob.Translate}
 */
function translate(query) {
    // if (!lang.langMap.get(query.detectTo)) {
    //     query.onCompletion({
    //         error: {
    //             type: "unsupportLanguage",
    //             message: "不支持该语种",
    //             addtion: "不支持该语种",
    //         },
    //     });
    // }

    if (query.detectFrom != "en" || query.detectTo != "zh-Hans") {
        query.onCompletion({
            error: {
                type: "unsupportLanguage",
                message: "目前仅支持英汉词典",
                addtion: "",
            },
        }); 
    }

    const { model, customModel, apiKeys, apiVersion, apiUrl, deploymentName } = $option;

    const isCustomModelRequired = model === "custom";

    if (isCustomModelRequired && !customModel) {
        query.onCompletion({
            error: {
                type: "param",
                message: "配置错误 - 请确保您在插件配置中填入了正确的自定义模型名称",
                addtion: "请在插件配置中填写自定义模型名称",
            },
        }); 
    }

    if (!apiKeys) {
        query.onCompletion({
            error: {
                type: "secretKey",
                message: "配置错误 - 请确保您在插件配置中填入了正确的 API Keys",
                addtion: "请在插件配置中填写 API Keys",
            },
        });
    }

    const modelValue = isCustomModelRequired ? customModel : model;

    const trimmedApiKeys = apiKeys.endsWith(",") ? apiKeys.slice(0, -1) : apiKeys;
    const apiKeySelection = trimmedApiKeys.split(",").map(key => key.trim());
    const apiKey = apiKeySelection[Math.floor(Math.random() * apiKeySelection.length)];

    const baseUrl = ensureHttpsAndNoTrailingSlash(apiUrl || "https://api.openai.com");
    let apiUrlPath = baseUrl.includes("gateway.ai.cloudflare.com") ? "/chat/completions" : "/v1/chat/completions";
    const apiVersionQuery = apiVersion ? `?api-version=${apiVersion}` : "?api-version=2023-03-15-preview";
    
    const isAzureServiceProvider = baseUrl.includes("openai.azure.com");
    if (isAzureServiceProvider) {
        if (deploymentName) {
            apiUrlPath = `/openai/deployments/${deploymentName}/chat/completions${apiVersionQuery}`;
        } else {
            query.onCompletion({
                error: {
                    type: "secretKey",
                    message: "配置错误 - 未填写 Deployment Name",
                    addtion: "请在插件配置中填写 Deployment Name",
                },
            });
        } 
    }

    const header = buildHeader(isAzureServiceProvider, apiKey);
    const body = buildRequestBody(modelValue, query);
    

    let targetText = ""; // 初始化拼接结果变量
    let buffer = ""; // 新增 buffer 变量
    (async () => {
        await $http.streamRequest({
            method: "POST",
            url: baseUrl + apiUrlPath,
            header,
            body,
            cancelSignal: query.cancelSignal,
            streamHandler: (streamData) => {
                if (streamData.text.includes("Invalid token")) {
                    query.onCompletion({
                        error: {
                            type: "secretKey",
                            message: "配置错误 - 请确保您在插件配置中填入了正确的 API Keys",
                            addtion: "请在插件配置中填写正确的 API Keys",
                        },
                    });
                } else {
                    // 将新的数据添加到缓冲变量中
                    buffer += streamData.text;
                    // 检查缓冲变量是否包含一个完整的消息
                    while (true) {
                        const match = buffer.match(/data: (.*?})\n/);
                        if (match) {
                            // 如果是一个完整的消息，处理它并从缓冲变量中移除
                            const textFromResponse = match[1].trim();
                            targetText = handleResponse(query, targetText, textFromResponse);
                            buffer = buffer.slice(match[0].length);
                        } else {
                            // 如果没有完整的消息，等待更多的数据
                            break;
                        }
                    }
                }
            },
            handler: (result) => {
                if (result.response.statusCode >= 400) {
                    handleError(query, result);
                } else {
                    query.onCompletion({
                        result: {
                            from: query.detectFrom,
                            to: query.detectTo,
                            toParagraphs: [targetText],
                        },
                    });
                }
            }
        });
    })().catch((err) => {
        query.onCompletion({
            error: {
                type: err._type || "unknown",
                message: err._message || "未知错误",
                addtion: err._addition,
            },
        });
    });
}

function supportLanguages() {
    return lang.supportLanguages.map(([standardLang]) => standardLang);
}

exports.supportLanguages = supportLanguages;
exports.translate = translate;
