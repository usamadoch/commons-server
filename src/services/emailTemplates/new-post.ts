/**
 * Email template: new-post
 *
 * Stub template — returns placeholder subject + body strings.
 * No HTML rendering, no template library.
 * Replace with real HTML templates once EMAIL_ENABLED is flipped on.
 */

export interface NewPostEmailData {
    title: string;
    body: string;
    actionUrl: string;
    [key: string]: unknown;
}

export const newPostTemplate = {
    name: 'new-post',

    subject: (data: NewPostEmailData): string => {
        return `New post: ${data.title}`;
    },

    body: (data: NewPostEmailData): string => {
        // TODO(email): Replace with real HTML template
        return `${data.body}\n\nView it here: ${data.actionUrl}`;
    },
};
