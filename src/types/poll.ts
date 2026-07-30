export interface IPoll {
    options: { text: string; votes: number }[];
    totalVotes: number;
    allowMultiple: boolean;
    endDate?: Date;
}
