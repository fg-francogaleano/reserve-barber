export class Barber {
  constructor(
    public readonly id: string,
    public readonly locationId: string,
    public readonly displayName: string,
    public readonly bio: string | null,
    public readonly isActive: boolean
  ) {}
}
