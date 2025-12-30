import type { IPointData } from "leafer-editor";
export interface RectLike {
    x: number;
    y: number;
    width: number;
    height: number;
}
export declare function expandRect(r: RectLike, pad: number): RectLike;
export declare function polylineMidpoint(points: IPointData[]): IPointData;
export declare function buildRoundedPolylinePath(points: IPointData[], radius: number): string;
export declare function buildOrthogonalBetween(from: IPointData, to: IPointData, avoidRects: RectLike[], options: {
    radius: number;
    intersectionPenalty?: number;
    longStraightRatio?: number;
    longStraightWeight?: number;
    enableSRoutes?: boolean;
}): {
    points: IPointData[];
    path: string;
    mid: IPointData;
    score: number;
};
//# sourceMappingURL=route.d.ts.map