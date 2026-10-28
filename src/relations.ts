export const DEFAULT_INVERSE_RELATIONS = 'next: prev\nsucc: pred';

export function parseInverseRelations(text: string): { forward: string; reverse: string }[] {
	if (typeof text !== 'string') throw new Error('Inverse relations must be text.');
	const used = new Set<string>();
	return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
		const parts = line.split(':').map(key => key.trim());
		if (parts.length !== 2 || parts.some(key => !key || /[[\]{}#,'"\t\r]/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key))) {
			throw new Error('Use one forward: reverse property pair per line (plain property names only).');
		}
		const [forward, reverse] = parts as [string, string];
		if (forward === reverse || used.has(forward) || used.has(reverse)) throw new Error('Each property can occur in only one inverse pair.');
		used.add(forward); used.add(reverse);
		return { forward, reverse };
	});
}
