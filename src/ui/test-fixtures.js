"use strict";

window.TestFixtures = {
    conversation: {
        uuid: "test-uuid-123",
        title: "Test Conversation",
        detail: {
            entries: [
                {
                    query: "What is AI?",
                    answer: "Artificial Intelligence is the simulation of human intelligence."
                },
                {
                    query: "Give an example",
                    answer: "Image recognition is a common AI application."
                }
            ]
        }
    },
    exports: {
        markdownIncludes: [
            "title: Test Conversation",
            "## 🙋 What is AI?",
            "Artificial Intelligence is the simulation of human intelligence."
        ],
        jsonKeys: ["meta", "data"],
        htmlIncludes: ["<!DOCTYPE html>", "Test Conversation"],
        textIncludes: ["QUESTION", "ANSWER"]
    }
};
