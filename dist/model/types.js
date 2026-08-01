export const CONTENT_RULE_ORDER = ['VS001', 'VS002', 'VS003', 'VS004'];
export function isRuleId(value) {
    return (value === 'VSRUN001' || CONTENT_RULE_ORDER.includes(value));
}
//# sourceMappingURL=types.js.map