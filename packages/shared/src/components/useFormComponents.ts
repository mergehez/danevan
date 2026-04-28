import { twMerge } from 'tailwind-merge';

type ClassNameValue = ClassNameArray | string | null | undefined | 0 | 0n | false;
type ClassNameArray = ClassNameValue[];

// export input
export const baseInputClass = 'w-full border border-x5 bg-x0 rounded-sm outline-none transition focus:border-blue-400 focus:bg-x1';
export function getInputSizedClasses(props: { smaller?: boolean; small?: boolean }) {
    return props.smaller ? 'text-2xs px-1.5 py-1' : props.small ? 'text-xs px-2 py-1.5' : 'text-sm px-3 py-2';
}

export function getFinalInputClass(props?: { smaller?: boolean; small?: boolean; class?: string }, ...overrides: ClassNameValue[]) {
    const sizeClasses = getInputSizedClasses(props || {});
    return twMerge(baseInputClass, sizeClasses, props?.class, ...overrides);
}
